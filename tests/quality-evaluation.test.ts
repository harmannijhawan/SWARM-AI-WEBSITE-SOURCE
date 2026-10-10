import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateResponse,
  compareEvaluations,
  exportEvaluationResults,
  EVALUATION_PROMPTS,
  type EvaluationPrompt,
  type AggregateEvaluation
} from '../lib/server/quality-evaluation';

test('evaluation prompts are well-formed', () => {
  assert(EVALUATION_PROMPTS.length > 0, 'Should have evaluation prompts');
  
  EVALUATION_PROMPTS.forEach(prompt => {
    assert(prompt.id, 'Prompt should have ID');
    assert(prompt.category, 'Prompt should have category');
    assert(prompt.prompt, 'Prompt should have text');
    assert(Array.isArray(prompt.expectedElements), 'Should have expected elements');
    assert(prompt.qualityCriteria, 'Should have quality criteria');
    assert(prompt.qualityCriteria.correctness, 'Should have correctness criteria');
    assert(prompt.qualityCriteria.completeness, 'Should have completeness criteria');
    assert(prompt.qualityCriteria.clarity, 'Should have clarity criteria');
    assert(prompt.qualityCriteria.errorHandling, 'Should have error handling criteria');
  });
});

test('evaluation prompts cover multiple categories', () => {
  const categories = new Set(EVALUATION_PROMPTS.map(p => p.category));
  
  assert(categories.has('code'), 'Should have code prompts');
  assert(categories.has('debugging'), 'Should have debugging prompts');
  assert(categories.has('explanation'), 'Should have explanation prompts');
  assert(categories.has('planning'), 'Should have planning prompts');
});

test('evaluateResponse detects expected elements', () => {
  const prompt: EvaluationPrompt = {
    id: 'test-001',
    category: 'code',
    prompt: 'Write a function',
    expectedElements: ['function', 'return', 'export'],
    qualityCriteria: {
      correctness: ['valid syntax'],
      completeness: ['function signature'],
      clarity: ['clear naming'],
      errorHandling: ['error check']
    }
  };
  
  const response = `
export function validateEmail(email: string): boolean {
  if (!email) return false;
  return /^[^@]+@[^@]+$/.test(email);
}
  `;
  
  const result = evaluateResponse(prompt, response);
  
  assert.equal(result.promptId, 'test-001');
  assert(result.foundElements.includes('function'));
  assert(result.foundElements.includes('return'));
  assert(result.foundElements.includes('export'));
  assert.equal(result.missingElements.length, 0);
});

test('evaluateResponse calculates scores', () => {
  const prompt: EvaluationPrompt = {
    id: 'test-002',
    category: 'code',
    prompt: 'Test',
    expectedElements: ['test', 'example'],
    qualityCriteria: {
      correctness: ['accurate'],
      completeness: ['complete'],
      clarity: ['clear'],
      errorHandling: ['error']
    }
  };
  
  const response = 'Test example with accurate, complete, clear error handling.';
  
  const result = evaluateResponse(prompt, response);
  
  assert(result.scores.correctness >= 0 && result.scores.correctness <= 100);
  assert(result.scores.completeness >= 0 && result.scores.completeness <= 100);
  assert(result.scores.clarity >= 0 && result.scores.clarity <= 100);
  assert(result.scores.errorHandling >= 0 && result.scores.errorHandling <= 100);
  assert(result.scores.overall >= 0 && result.scores.overall <= 100);
});

test('evaluateResponse detects code blocks', () => {
  const prompt: EvaluationPrompt = {
    id: 'test-003',
    category: 'code',
    prompt: 'Test',
    expectedElements: [],
    qualityCriteria: {
      correctness: [],
      completeness: [],
      clarity: [],
      errorHandling: []
    }
  };
  
  const responseWithCode = '```typescript\nconst x = 1;\n```';
  const responseWithoutCode = 'Just text';
  
  const resultWith = evaluateResponse(prompt, responseWithCode);
  const resultWithout = evaluateResponse(prompt, responseWithoutCode);
  
  assert.equal(resultWith.hasCodeBlock, true);
  assert.equal(resultWithout.hasCodeBlock, false);
});

test('evaluateResponse detects examples', () => {
  const prompt: EvaluationPrompt = {
    id: 'test-004',
    category: 'explanation',
    prompt: 'Test',
    expectedElements: [],
    qualityCriteria: {
      correctness: [],
      completeness: [],
      clarity: [],
      errorHandling: []
    }
  };
  
  const responseWithExample = 'Here is an example of usage...';
  const responseWithoutExample = 'Just explanation';
  
  const resultWith = evaluateResponse(prompt, responseWithExample);
  const resultWithout = evaluateResponse(prompt, responseWithoutExample);
  
  assert.equal(resultWith.hasExamples, true);
  assert.equal(resultWithout.hasExamples, false);
});

test('evaluateResponse detects error handling keywords', () => {
  const prompt: EvaluationPrompt = {
    id: 'test-005',
    category: 'code',
    prompt: 'Test',
    expectedElements: [],
    qualityCriteria: {
      correctness: [],
      completeness: [],
      clarity: [],
      errorHandling: []
    }
  };
  
  const responseWithError = 'try { } catch (error) { }';
  const responseWithoutError = 'Just code';
  
  const resultWith = evaluateResponse(prompt, responseWithError);
  const resultWithout = evaluateResponse(prompt, responseWithoutError);
  
  assert.equal(resultWith.hasErrorHandling, true);
  assert.equal(resultWithout.hasErrorHandling, false);
});

test('evaluateResponse rewards code blocks for code prompts', () => {
  const prompt: EvaluationPrompt = {
    id: 'test-006',
    category: 'code',
    prompt: 'Write code',
    expectedElements: ['function'],
    qualityCriteria: {
      correctness: ['correct'],
      completeness: ['complete'],
      clarity: ['clear'],
      errorHandling: []
    }
  };
  
  const responseWithCode = '```typescript\nfunction test() { }\n```\nThis is a correct, complete, clear function.';
  const responseWithoutCode = 'function test() { }\nThis is a correct, complete, clear function.';
  
  const resultWith = evaluateResponse(prompt, responseWithCode);
  const resultWithout = evaluateResponse(prompt, responseWithoutCode);
  
  // Response with code block should score higher on completeness
  assert(resultWith.scores.completeness >= resultWithout.scores.completeness);
});

test('evaluateResponse overall score is weighted average', () => {
  const prompt: EvaluationPrompt = {
    id: 'test-007',
    category: 'code',
    prompt: 'Test',
    expectedElements: [],
    qualityCriteria: {
      correctness: [],
      completeness: [],
      clarity: [],
      errorHandling: []
    }
  };
  
  const result = evaluateResponse(prompt, 'test response');
  
  // Overall should be weighted: 35% correctness, 30% completeness, 20% clarity, 15% error handling
  const expectedOverall = Math.round(
    result.scores.correctness * 0.35 +
    result.scores.completeness * 0.30 +
    result.scores.clarity * 0.20 +
    result.scores.errorHandling * 0.15
  );
  
  assert.equal(result.scores.overall, expectedOverall);
});

test('compareEvaluations calculates improvements', () => {
  const baseline: AggregateEvaluation = {
    totalPrompts: 5,
    averageScores: {
      correctness: 60,
      completeness: 50,
      clarity: 55,
      errorHandling: 40,
      overall: 55
    },
    categoryBreakdown: {},
    timestamp: new Date().toISOString()
  };
  
  const improved: AggregateEvaluation = {
    totalPrompts: 5,
    averageScores: {
      correctness: 75,
      completeness: 70,
      clarity: 70,
      errorHandling: 65,
      overall: 72
    },
    categoryBreakdown: {},
    timestamp: new Date().toISOString()
  };
  
  const comparison = compareEvaluations(baseline, improved);
  
  assert.equal(comparison.improvements.correctness, 15);
  assert.equal(comparison.improvements.completeness, 20);
  assert.equal(comparison.improvements.clarity, 15);
  assert.equal(comparison.improvements.errorHandling, 25);
  assert.equal(comparison.improvements.overall, 17);
  
  assert(comparison.summary.includes('+15'));
  assert(comparison.summary.includes('+20'));
  assert(comparison.summary.includes('+17'));
});

test('compareEvaluations handles regressions', () => {
  const baseline: AggregateEvaluation = {
    totalPrompts: 5,
    averageScores: {
      correctness: 75,
      completeness: 70,
      clarity: 70,
      errorHandling: 65,
      overall: 72
    },
    categoryBreakdown: {},
    timestamp: new Date().toISOString()
  };
  
  const worse: AggregateEvaluation = {
    totalPrompts: 5,
    averageScores: {
      correctness: 60,
      completeness: 55,
      clarity: 60,
      errorHandling: 50,
      overall: 58
    },
    categoryBreakdown: {},
    timestamp: new Date().toISOString()
  };
  
  const comparison = compareEvaluations(baseline, worse);
  
  assert.equal(comparison.improvements.correctness, -15);
  assert.equal(comparison.improvements.completeness, -15);
  assert.equal(comparison.improvements.clarity, -10);
  assert.equal(comparison.improvements.errorHandling, -15);
  assert.equal(comparison.improvements.overall, -14);
  
  assert(comparison.summary.includes('-15'));
  assert(comparison.summary.includes('-14'));
});

test('exportEvaluationResults generates valid JSON', () => {
  const prompt: EvaluationPrompt = {
    id: 'export-test',
    category: 'code',
    prompt: 'Test',
    expectedElements: ['test'],
    qualityCriteria: {
      correctness: ['correct'],
      completeness: ['complete'],
      clarity: ['clear'],
      errorHandling: ['error']
    }
  };
  
  const result = evaluateResponse(prompt, 'test response');
  
  const aggregate: AggregateEvaluation = {
    totalPrompts: 1,
    averageScores: result.scores,
    categoryBreakdown: { code: { count: 1, averageScore: result.scores.overall } },
    timestamp: new Date().toISOString()
  };
  
  const exported = exportEvaluationResults([result], aggregate, 'test.json');
  const parsed = JSON.parse(exported);
  
  assert(parsed.metadata);
  assert(parsed.metadata.timestamp);
  assert.equal(parsed.metadata.totalPrompts, 1);
  assert(parsed.aggregate);
  assert(Array.isArray(parsed.results));
  assert.equal(parsed.results.length, 1);
});

test('evaluation handles missing elements', () => {
  const prompt: EvaluationPrompt = {
    id: 'missing-test',
    category: 'code',
    prompt: 'Test',
    expectedElements: ['missing1', 'missing2', 'present'],
    qualityCriteria: {
      correctness: ['criterion1'],
      completeness: ['criterion2'],
      clarity: ['criterion3'],
      errorHandling: ['criterion4']
    }
  };
  
  const result = evaluateResponse(prompt, 'present but not others');
  
  assert(result.foundElements.includes('present'));
  assert(result.missingElements.includes('missing1'));
  assert(result.missingElements.includes('missing2'));
  assert.equal(result.missingElements.length, 2);
});

test('evaluation is case-insensitive for elements', () => {
  const prompt: EvaluationPrompt = {
    id: 'case-test',
    category: 'code',
    prompt: 'Test',
    expectedElements: ['Function', 'Return', 'Export'],
    qualityCriteria: {
      correctness: [],
      completeness: [],
      clarity: [],
      errorHandling: []
    }
  };
  
  const result = evaluateResponse(prompt, 'function test() { return; } export default test;');
  
  assert.equal(result.foundElements.length, 3);
  assert.equal(result.missingElements.length, 0);
});

test('clarity score rewards structured content', () => {
  const prompt: EvaluationPrompt = {
    id: 'structure-test',
    category: 'explanation',
    prompt: 'Test',
    expectedElements: [],
    qualityCriteria: {
      correctness: [],
      completeness: [],
      clarity: [],
      errorHandling: []
    }
  };
  
  const structured = `# Title\n\n- Point 1\n- Point 2\n\n\`\`\`code\nExample\n\`\`\`\n\nFor example...`;
  const unstructured = 'Just a plain paragraph of text without any structure or formatting.';
  
  const resultStructured = evaluateResponse(prompt, structured);
  const resultUnstructured = evaluateResponse(prompt, unstructured);
  
  assert(resultStructured.scores.clarity > resultUnstructured.scores.clarity);
});

test('completeness score considers response length', () => {
  const prompt: EvaluationPrompt = {
    id: 'length-test',
    category: 'code',
    prompt: 'Test',
    expectedElements: ['test'],
    qualityCriteria: {
      correctness: ['test'],
      completeness: ['complete', 'thorough', 'detailed'],
      clarity: [],
      errorHandling: []
    }
  };
  
  const complete = 'This is a complete and thorough and detailed test response with examples and explanations.';
  const incomplete = 'test';
  
  const resultComplete = evaluateResponse(prompt, complete);
  const resultIncomplete = evaluateResponse(prompt, incomplete);
  
  assert(resultComplete.scores.completeness > resultIncomplete.scores.completeness);
});

test('evaluation tracks response metadata', () => {
  const prompt: EvaluationPrompt = {
    id: 'metadata-test',
    category: 'code',
    prompt: 'Test',
    expectedElements: ['test'],
    qualityCriteria: {
      correctness: [],
      completeness: [],
      clarity: [],
      errorHandling: []
    }
  };
  
  const response = 'Test response with some content';
  const result = evaluateResponse(prompt, response);
  
  assert.equal(result.promptId, prompt.id);
  assert.equal(result.category, prompt.category);
  assert.equal(result.response, response);
  assert.equal(result.responseLength, response.length);
  assert(result.timestamp);
  assert(Date.parse(result.timestamp), 'Timestamp should be valid ISO date');
});
