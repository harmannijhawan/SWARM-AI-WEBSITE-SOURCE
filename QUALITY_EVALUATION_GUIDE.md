# Quality Evaluation Guide

This guide explains how to measure response quality improvements from the enhanced system prompts.

## Overview

The quality evaluation suite tests SWARM AI responses across 4 dimensions:
1. **Correctness** (35% weight) - Technical accuracy, proper implementation
2. **Completeness** (30% weight) - All required elements present, thorough coverage
3. **Clarity** (20% weight) - Clear structure, readable, well-explained
4. **Error Handling** (15% weight) - Edge cases, validation, error states

## Test Coverage

The suite includes 8 evaluation prompts across 4 categories:

### Code Generation (4 prompts)
- `code-basic-001`: Simple email validation function
- `code-complex-001`: React component with API fetch + loading/error states
- `code-edge-001`: Safe JSON parsing with error handling
- `code-api-001`: REST API endpoint design

### Debugging (1 prompt)
- `debug-001`: Array.map() doesn't mutate original array

### Explanation (2 prompts)
- `explain-001`: How async/await works
- `explain-advanced-001`: OAuth2 vs JWT comparison

### Planning (1 prompt)
- `plan-001`: Todo app architecture planning

## Evaluation Criteria

Each prompt has specific quality criteria:

### Correctness Criteria
- Valid implementation patterns
- Proper API usage
- Accurate technical explanations
- Correct execution flow

### Completeness Criteria
- All required code elements present
- TypeScript types included
- Usage examples provided
- Edge cases mentioned
- Setup/configuration covered

### Clarity Criteria
- Clear function/variable names
- Structured explanation (headers, lists)
- Code comments for complex logic
- Examples illustrating concepts
- Readable formatting

### Error Handling Criteria
- Try-catch blocks where needed
- Null/undefined checks
- Validation logic
- Error state UI
- Abort/cleanup logic

## Running Evaluations

### Prerequisites

The evaluation suite requires a running backend to generate real responses. You have two options:

#### Option 1: Manual API Testing (Recommended for Baseline)

1. Start the development server:
```bash
cd swarm-ai-website-design
npm run dev
```

2. Use the web UI or API client to submit each test prompt manually
3. Copy responses into evaluation files
4. Run scoring with captured responses

#### Option 2: Automated with Live Backend

Integrate the evaluation runner with your deployed backend:

```typescript
// In run-quality-eval.ts, replace mockChatFunction with:
async function realChatFunction(prompt: string, mode: string = 'chat'): Promise<string> {
  const response = await fetch('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer YOUR_TOKEN'
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      mode
    })
  });
  
  const data = await response.json();
  return data.response; // Adjust based on your API structure
}
```

### Capturing Baseline Metrics

**BEFORE** deploying improved prompts:

1. Ensure backend uses OLD prompts (revert improved-prompts.ts changes temporarily)
2. Start dev server: `npm run dev`
3. Run evaluation: `npm run eval:quality -- --mode baseline`
4. Save results: `.evaluation/evaluation-baseline-YYYY-MM-DD.json`

### Capturing Improved Metrics

**AFTER** deploying improved prompts:

1. Ensure backend uses NEW prompts (improved-prompts.ts integrated)
2. Start dev server: `npm run dev`
3. Run evaluation: `npm run eval:quality -- --mode improved`
4. Save results: `.evaluation/evaluation-improved-YYYY-MM-DD.json`

### Comparing Results

```bash
npm run eval:quality -- --compare \
  .evaluation/evaluation-baseline-2025-01-15.json \
  .evaluation/evaluation-improved-2025-01-15.json
```

## Interpreting Results

### Score Ranges

- **90-100**: Excellent - Production ready, comprehensive, clear
- **75-89**: Good - Solid implementation, minor improvements possible
- **60-74**: Acceptable - Works but missing elements or clarity
- **40-59**: Poor - Significant gaps in quality
- **0-39**: Failed - Major issues, incomplete or incorrect

### Expected Improvements

Based on prompt enhancements, we expect:

| Dimension | Baseline | Target | Improvement |
|-----------|----------|--------|-------------|
| Correctness | 65-70 | 80-85 | +15-20 points |
| Completeness | 55-60 | 75-80 | +20-25 points |
| Clarity | 60-65 | 75-80 | +15-20 points |
| Error Handling | 40-45 | 65-70 | +25-30 points |
| **Overall** | **60-65** | **78-82** | **+18-20 points** |

### Red Flags

- **Decreased correctness**: Prompts may be too verbose or confusing
- **Decreased completeness**: Prompts may be constraining responses too much
- **No improvement in error handling**: Criteria not explicit enough
- **Overall score < baseline**: Revert changes and analyze what went wrong

## Scoring Algorithm

### Correctness (0-100)
```
criteriaScore = (criteriaMet / totalCriteria) * 100
elementScore = (foundElements / expectedElements) * 100
final = criteriaScore * 0.6 + elementScore * 0.4
```

### Completeness (0-100)
```
criteriaScore = (criteriaMet / totalCriteria) * 70
bonus = +15 if hasCodeBlock (for code prompts)
bonus = +15 if hasExamples
final = min(100, criteriaScore + bonuses)
```

### Clarity (0-100)
```
base = 50
bonus = +10 if hasHeaders
bonus = +10 if hasBulletPoints or hasNumberedList
bonus = +10 if hasCodeBlock
bonus = +10 if hasExamples
bonus = +10 if avgParagraphLength < 500 chars
final = min(100, base + bonuses)
```

### Error Handling (0-100)
```
criteriaScore = (criteriaMet / totalCriteria) * 80
bonus = +20 if hasErrorHandling keywords
final = min(100, criteriaScore + bonus)
```

### Overall (0-100)
```
overall = correctness * 0.35
        + completeness * 0.30
        + clarity * 0.20
        + errorHandling * 0.15
```

## Adding Custom Prompts

To add new evaluation prompts:

```typescript
// In quality-evaluation.ts, add to EVALUATION_PROMPTS array:
{
  id: 'custom-001',
  category: 'code',
  prompt: 'Your test prompt here',
  expectedElements: [
    'keyword1',
    'keyword2',
    'concept'
  ],
  qualityCriteria: {
    correctness: [
      'criterion 1',
      'criterion 2'
    ],
    completeness: [
      'element 1 present',
      'element 2 present'
    ],
    clarity: [
      'clear structure',
      'examples shown'
    ],
    errorHandling: [
      'error handling present',
      'validation included'
    ]
  }
}
```

## Best Practices

### DO
- ✅ Run evaluations multiple times and average results
- ✅ Use same backend version for baseline and improved runs
- ✅ Test with real API calls, not mocks
- ✅ Document any anomalies or outliers
- ✅ Review individual responses, not just aggregate scores
- ✅ Report honest results, even if negative

### DON'T
- ❌ Cherry-pick best runs
- ❌ Fabricate or inflate scores
- ❌ Compare different model versions
- ❌ Change routing during evaluation
- ❌ Modify test prompts between runs
- ❌ Skip low-scoring prompts

## Troubleshooting

### Mock Responses Used
**Issue**: Script uses mock responses instead of real API
**Fix**: Integrate realChatFunction with your backend (see Option 2 above)

### Low Baseline Scores
**Issue**: Baseline scores lower than expected
**Fix**: This is valuable data! Don't manipulate it. Report honestly and analyze why.

### No Improvement After Prompt Changes
**Issue**: Improved scores same as baseline
**Fix**: 
1. Verify improved-prompts.ts is actually being used
2. Check if prompts are too similar to originals
3. Review individual responses for subtle improvements
4. Consider that prompts may need further iteration

### High Variance Between Runs
**Issue**: Scores vary significantly between runs
**Fix**:
1. Run 3-5 evaluations and report median scores
2. Check for model temperature settings (should be consistent)
3. Verify same routing algorithm used
4. Document variance in engineering report

## Output Files

Evaluation results are saved to `.evaluation/` directory:

```
.evaluation/
├── evaluation-baseline-2025-01-15T10-30-00.json
├── evaluation-improved-2025-01-15T14-20-00.json
└── comparison-report-2025-01-15.md
```

### JSON Structure
```json
{
  "metadata": {
    "timestamp": "2025-01-15T10:30:00Z",
    "totalPrompts": 8,
    "version": "1.0.0"
  },
  "aggregate": {
    "totalPrompts": 8,
    "averageScores": {
      "correctness": 78,
      "completeness": 72,
      "clarity": 68,
      "errorHandling": 65,
      "overall": 73
    },
    "categoryBreakdown": {
      "code": { "count": 4, "averageScore": 75 },
      "explanation": { "count": 2, "averageScore": 70 }
    }
  },
  "results": [ /* individual evaluations */ ]
}
```

## Integration with Engineering Report

Use evaluation results in the final engineering report:

1. **Executive Summary**: Overall improvement percentage
2. **Quality Improvements Section**: 
   - Before/after scores table
   - Dimension-specific improvements
   - Category breakdown
3. **Detailed Analysis**:
   - Top 3 most improved prompts
   - Any regressions or failures
   - Root cause analysis
4. **Recommendations**:
   - What worked well
   - What needs further iteration
   - Next steps for continued improvement

## Next Steps

After completing quality evaluation:
1. ✅ Task 10: Create quality evaluation suite (DONE)
2. → Task 11: Run quality evaluation and measure improvements (NEXT)
3. → Task 12: Add comprehensive tests
4. → Task 13: Run full build verification
5. → Task 14: Create engineering report with honest metrics
