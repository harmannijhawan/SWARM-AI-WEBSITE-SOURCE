# Quality Evaluation Measurement Procedure

This document provides step-by-step instructions for capturing baseline and improved quality metrics.

## ⚠️ Important Note on Real Measurements

The quality evaluation requires **real API responses** from a running SWARM backend. The evaluation cannot be fully automated in the current setup because:

1. Backend requires environment variables (API keys) that are not in the repository
2. Database must be initialized with proper schema
3. User authentication/authorization must be configured
4. Provider API keys must be valid and have quota

**Two approaches are available:**

### Approach A: Automated with Live Backend (Recommended)
Run the capture script against a running development server.

### Approach B: Manual Response Collection
Manually submit prompts through the UI and copy responses for evaluation.

---

## Approach A: Automated Measurement

### Prerequisites

1. **Environment Variables Configured**
   ```bash
   # Required provider keys
   export GROQ_API_KEY=your_key_here
   export OPENROUTER_API_KEY=your_key_here
   export GEMINI_API_KEY=your_key_here
   # ... other providers
   
   # Required configuration
   export SWARM_STANDARD_MODELS="model-id-1,model-id-2"
   export SWARM_FREE_BUILDS=5
   export SWARM_FREE_CHATS=2
   
   # Clerk authentication
   export NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_key
   export CLERK_SECRET_KEY=your_key
   ```

2. **Database Initialized**
   ```bash
   cd swarm-ai-website-design
   # Run database migrations
   npm run db:migrate  # If you have migrations
   ```

3. **Authentication Token**
   - Create a test user account
   - Get auth token from browser dev tools or Clerk dashboard
   - Export as environment variable:
     ```bash
     export SWARM_AUTH_TOKEN=your_token_here
     ```

### Step 1: Capture Baseline Metrics (BEFORE Improvements)

**CRITICAL**: This step captures responses using OLD prompts for comparison.

1. **Temporarily revert to old prompts**:
   ```bash
   cd swarm-ai-website-design
   
   # Backup current improved prompts
   cp lib/server/improved-prompts.ts lib/server/improved-prompts.ts.backup
   cp lib/server/backend.ts lib/server/backend.ts.backup
   ```

2. **Revert backend to use old inline prompts**:
   
   Edit `lib/server/backend.ts` and replace the system prompt sections with original simple prompts:
   
   ```typescript
   // Chat mode - ORIGINAL
   const systemPrompt = 'You are SWARM AI, an intelligent assistant. Be accurate and useful. For code requests, provide complete runnable files with imports and error handling.';
   
   // Planner - ORIGINAL  
   const systemPrompt = 'Plan an accurate complete response. Return a concise strategy.';
   
   // Coder - ORIGINAL
   const systemPrompt = basePrompt + `\n\nFollow this strategy:\n${strategy}`;
   
   // Reviewer - ORIGINAL
   const systemPrompt = basePrompt + `\n\nReview this draft and output the improved final answer:\n${draft}`;
   
   // Continue - ORIGINAL
   const systemPrompt = 'Continue the previous answer without repeating it.';
   ```

3. **Start the development server**:
   ```bash
   npm run dev
   ```

4. **Capture baseline responses**:
   ```bash
   # In a new terminal
   export SWARM_API_URL=http://localhost:3000
   export SWARM_AUTH_TOKEN=your_token_here
   
   npm run capture:responses -- --mode baseline
   ```

5. **Wait for completion** (approximately 30-60 seconds for 8 prompts)

6. **Verify baseline results**:
   ```bash
   ls -la .evaluation/
   cat .evaluation/evaluation-baseline-*.json | jq '.aggregate.averageScores'
   ```

   Expected baseline scores (based on original prompts):
   ```json
   {
     "correctness": 60-70,
     "completeness": 50-60,
     "clarity": 55-65,
     "errorHandling": 35-45,
     "overall": 55-65
   }
   ```

### Step 2: Capture Improved Metrics (AFTER Improvements)

1. **Restore improved prompts**:
   ```bash
   # Restore from backup
   cp lib/server/backend.ts.backup lib/server/backend.ts
   cp lib/server/improved-prompts.ts.backup lib/server/improved-prompts.ts
   
   # Verify improved prompts are active
   grep "getSystemPrompt" lib/server/backend.ts
   ```

2. **Restart the development server**:
   ```bash
   # Stop the old server (Ctrl+C)
   npm run dev
   ```

3. **Capture improved responses**:
   ```bash
   # Same environment as baseline
   npm run capture:responses -- --mode improved
   ```

4. **Wait for completion** (approximately 30-60 seconds for 8 prompts)

5. **Verify improved results**:
   ```bash
   cat .evaluation/evaluation-improved-*.json | jq '.aggregate.averageScores'
   ```

   Expected improved scores (based on enhanced prompts):
   ```json
   {
     "correctness": 75-85,
     "completeness": 70-80,
     "clarity": 70-80,
     "errorHandling": 60-70,
     "overall": 72-82
   }
   ```

### Step 3: Compare Results

```bash
npm run eval:quality -- --compare \
  .evaluation/evaluation-baseline-YYYY-MM-DDTHH-MM-SS.json \
  .evaluation/evaluation-improved-YYYY-MM-DDTHH-MM-SS.json
```

Expected output:
```
============================================================
📊 QUALITY EVALUATION COMPARISON
============================================================
Quality Improvement Summary:
- Correctness: +15 points (65 → 80)
- Completeness: +20 points (55 → 75)
- Clarity: +15 points (60 → 75)
- Error Handling: +25 points (40 → 65)
- Overall: +18 points (60 → 78)
============================================================

✅ Overall quality improved by 18 points
```

---

## Approach B: Manual Measurement

If automated capture doesn't work due to environment constraints:

### Step 1: Manual Baseline Collection

1. Start server with OLD prompts (follow Step 1 from Approach A)

2. Open web UI at `http://localhost:3000`

3. For each test prompt in `.evaluation/test-prompts.md`:
   - Submit prompt in chat
   - Copy full response
   - Save to `.evaluation/baseline-responses/prompt-id.txt`

4. Run scoring manually:
   ```bash
   npm run eval:quality -- --score-files .evaluation/baseline-responses/*.txt --mode baseline
   ```

### Step 2: Manual Improved Collection

1. Start server with IMPROVED prompts

2. Submit same prompts, save responses to `.evaluation/improved-responses/prompt-id.txt`

3. Run scoring:
   ```bash
   npm run eval:quality -- --score-files .evaluation/improved-responses/*.txt --mode improved
   ```

### Step 3: Compare

Same as Approach A Step 3.

---

## Troubleshooting

### Issue: API Connection Failed

**Error**: `Cannot reach API. Is the server running?`

**Fix**:
1. Verify server is running: `curl http://localhost:3000/api/health`
2. Check firewall settings
3. Try `127.0.0.1` instead of `localhost`

### Issue: Authentication Failed

**Error**: `API request failed: 401 Unauthorized`

**Fix**:
1. Verify auth token is valid
2. Check token hasn't expired
3. Ensure Clerk is configured properly
4. Try without auth token (if anonymous access is enabled)

### Issue: Rate Limiting

**Error**: `API request failed: 429 Too Many Requests`

**Fix**:
1. Increase delay between requests in capture script (currently 2s)
2. Increase rate limits in environment: `export SWARM_HOURLY_REQUESTS=100`
3. Wait for rate limit window to reset

### Issue: Provider Errors

**Error**: Multiple prompts returning errors

**Fix**:
1. Check provider API keys are valid
2. Verify providers have remaining quota
3. Check provider status pages
4. Try with different providers

### Issue: Low Scores on Baseline

**Problem**: Baseline scores lower than expected (e.g., overall < 50)

**This is OK!** Don't fabricate or manipulate scores. Document the finding:
- Original prompts may be simpler than expected
- Provides clear opportunity for improvement
- Report honestly in engineering report

### Issue: No Improvement After Enhancements

**Problem**: Improved scores same as or lower than baseline

**Investigation Steps**:
1. Verify improved prompts are actually loaded:
   ```bash
   # Check if getSystemPrompt is used
   grep -n "getSystemPrompt" lib/server/backend.ts
   
   # Check imports
   grep "improved-prompts" lib/server/backend.ts
   ```

2. Check server was restarted after code changes

3. Review actual responses - improvements may be subtle:
   - More structured formatting
   - Better error handling mentioned
   - More complete examples
   - Clearer explanations

4. Run evaluation multiple times - LLM responses vary

5. Consider that prompts may need further iteration

**Never fabricate improvements.** Report honest results and analyze why changes didn't have expected impact.

---

## Quality Standards for Measurement

### ✅ DO
- Run each capture at least once, preferably 2-3 times for variance analysis
- Use same backend version for baseline and improved
- Use same authentication token
- Use same environment variables
- Document any anomalies or failed prompts
- Review individual responses, not just aggregate scores
- Report honest results in engineering report
- Note variance between runs if significant

### ❌ DON'T  
- Cherry-pick best runs
- Fabricate or inflate scores
- Compare different model versions
- Change routing between runs
- Modify test prompts between runs
- Skip low-scoring prompts
- Manually adjust scores
- Retry only failed prompts selectively

---

## Expected Results

### Baseline (Old Prompts)
- Short, generic responses
- Missing error handling
- Incomplete examples
- Less structured output
- **Overall: 55-65/100**

### Improved (New Prompts)
- Comprehensive responses
- Explicit error handling
- Complete code examples with usage
- Well-structured with headers/sections
- **Overall: 72-82/100**

### Improvement Target
- **+15-20 points overall**
- **+20-25 points completeness** (biggest gain expected)
- **+25-30 points error handling** (explicit requirements added)
- **+15-20 points correctness and clarity**

---

## Integration with Engineering Report

Use captured results for Task #14:

1. **Executive Summary**: State overall improvement (e.g., "+18 points")

2. **Baseline vs Improved Table**:
   ```markdown
   | Dimension | Baseline | Improved | Change |
   |-----------|----------|----------|--------|
   | Correctness | 65 | 80 | +15 |
   | Completeness | 55 | 75 | +20 |
   | Clarity | 60 | 75 | +15 |
   | Error Handling | 40 | 65 | +25 |
   | **Overall** | **60** | **78** | **+18** |
   ```

3. **Individual Prompt Analysis**:
   - Best improvements (which prompts gained most)
   - Any regressions (which prompts scored lower)
   - Category breakdown (code vs explanation vs debugging)

4. **Sample Comparison**:
   - Pick 1-2 prompts
   - Show baseline response vs improved response
   - Highlight specific quality gains

5. **Honest Assessment**:
   - What worked well
   - What didn't meet expectations
   - Why certain improvements occurred
   - Recommendations for further iteration

---

## Next Steps After Measurement

1. ✅ Capture baseline and improved metrics
2. ✅ Generate comparison report
3. → Document findings in engineering report (Task #14)
4. → If improvements insufficient, iterate on prompts
5. → If improvements meet targets, proceed with deployment planning

## Files Generated

After measurement, you'll have:
```
.evaluation/
├── evaluation-baseline-2025-01-15T10-30-00.json
├── evaluation-improved-2025-01-15T14-20-00.json
└── comparison-summary.txt
```

Use these files as evidence in the engineering report.
