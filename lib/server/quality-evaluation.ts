/**
 * Quality Evaluation Suite
 * 
 * Measures response quality improvements from enhanced system prompts.
 * Tests code correctness, completeness, clarity, and error handling.
 * 
 * Usage:
 *   import { evaluateQuality, runEvaluationSuite } from './quality-evaluation';
 *   const results = await runEvaluationSuite(chatFunction);
 */

export interface EvaluationPrompt {
  id: string;
  category: 'code' | 'explanation' | 'debugging' | 'planning';
  prompt: string;
  expectedElements: string[];
  qualityCriteria: {
    correctness: string[];
    completeness: string[];
    clarity: string[];
    errorHandling: string[];
  };
}

export interface EvaluationResult {
  promptId: string;
  category: string;
  response: string;
  scores: {
    correctness: number;      // 0-100
    completeness: number;     // 0-100
    clarity: number;          // 0-100
    errorHandling: number;    // 0-100
    overall: number;          // 0-100
  };
  foundElements: string[];
  missingElements: string[];
  responseLength: number;
  hasCodeBlock: boolean;
  hasExamples: boolean;
  hasErrorHandling: boolean;
  timestamp: string;
}

export interface AggregateEvaluation {
  totalPrompts: number;
  averageScores: {
    correctness: number;
    completeness: number;
    clarity: number;
    errorHandling: number;
    overall: number;
  };
  categoryBreakdown: {
    [category: string]: {
      count: number;
      averageScore: number;
    };
  };
  timestamp: string;
}

/**
 * Test prompts covering different scenarios
 */
export const EVALUATION_PROMPTS: EvaluationPrompt[] = [
  // Code generation - Basic
  {
    id: 'code-basic-001',
    category: 'code',
    prompt: 'Write a TypeScript function to validate an email address',
    expectedElements: [
      'function',
      'email',
      'regex',
      'return',
      'boolean',
      'export'
    ],
    qualityCriteria: {
      correctness: [
        'valid email regex pattern',
        'handles null/undefined input',
        'returns boolean'
      ],
      completeness: [
        'function signature with types',
        'implementation',
        'usage example',
        'test cases mentioned'
      ],
      clarity: [
        'clear function name',
        'comments explaining regex',
        'example usage shown'
      ],
      errorHandling: [
        'null check',
        'undefined check',
        'invalid input handling'
      ]
    }
  },

  // Code generation - Complex
  {
    id: 'code-complex-001',
    category: 'code',
    prompt: 'Create a React component that fetches and displays user data from an API with loading and error states',
    expectedElements: [
      'useState',
      'useEffect',
      'fetch',
      'loading',
      'error',
      'return',
      'JSX',
      'interface'
    ],
    qualityCriteria: {
      correctness: [
        'proper React hooks usage',
        'async/await or promises',
        'state management for loading/error/data',
        'cleanup on unmount'
      ],
      completeness: [
        'TypeScript interface for user data',
        'loading state UI',
        'error state UI',
        'success state UI',
        'fetch implementation',
        'usage example'
      ],
      clarity: [
        'clear component name',
        'comments for complex logic',
        'readable JSX structure',
        'prop types defined'
      ],
      errorHandling: [
        'try-catch or .catch()',
        'error state display',
        'network error handling',
        'abort controller for cleanup'
      ]
    }
  },

  // Debugging
  {
    id: 'debug-001',
    category: 'debugging',
    prompt: 'Why is this code not working? `const arr = [1,2,3]; arr.map(x => x + 1); console.log(arr);` It prints [1,2,3] instead of [2,3,4]',
    expectedElements: [
      'map',
      'returns',
      'new array',
      'immutable',
      'assign',
      'const result'
    ],
    qualityCriteria: {
      correctness: [
        'explains map returns new array',
        'explains original array unchanged',
        'provides correct solution'
      ],
      completeness: [
        'explanation of the issue',
        'corrected code',
        'before/after comparison',
        'explanation of map behavior'
      ],
      clarity: [
        'clear explanation',
        'highlighted the key concept',
        'easy to understand'
      ],
      errorHandling: [
        'mentions immutability',
        'explains why original unchanged'
      ]
    }
  },

  // Explanation
  {
    id: 'explain-001',
    category: 'explanation',
    prompt: 'Explain how async/await works in JavaScript',
    expectedElements: [
      'Promise',
      'async',
      'await',
      'synchronous',
      'try',
      'catch',
      'example'
    ],
    qualityCriteria: {
      correctness: [
        'accurate description of async/await',
        'relationship to Promises explained',
        'execution flow correct'
      ],
      completeness: [
        'what async keyword does',
        'what await keyword does',
        'error handling with try-catch',
        'code example',
        'comparison to .then() syntax'
      ],
      clarity: [
        'clear progression of concepts',
        'examples illustrate points',
        'avoids jargon or explains it',
        'structured explanation'
      ],
      errorHandling: [
        'mentions try-catch',
        'explains error propagation',
        'shows error handling example'
      ]
    }
  },

  // Planning
  {
    id: 'plan-001',
    category: 'planning',
    prompt: 'I want to build a todo app with React and Node.js. What should I do?',
    expectedElements: [
      'frontend',
      'backend',
      'database',
      'API',
      'steps',
      'components'
    ],
    qualityCriteria: {
      correctness: [
        'mentions frontend (React)',
        'mentions backend (Node.js)',
        'mentions data persistence',
        'mentions API communication'
      ],
      completeness: [
        'frontend architecture',
        'backend architecture',
        'database choice',
        'API design',
        'authentication (if mentioned)',
        'deployment considerations',
        'step-by-step approach'
      ],
      clarity: [
        'organized structure',
        'clear steps',
        'prioritization or ordering',
        'easy to follow'
      ],
      errorHandling: [
        'mentions error handling',
        'mentions validation',
        'mentions edge cases'
      ]
    }
  },

  // Code with edge cases
  {
    id: 'code-edge-001',
    category: 'code',
    prompt: 'Write a function to safely parse JSON that might be invalid',
    expectedElements: [
      'try',
      'catch',
      'JSON.parse',
      'return',
      'null',
      'error'
    ],
    qualityCriteria: {
      correctness: [
        'uses try-catch',
        'returns appropriate value on error',
        'handles invalid JSON'
      ],
      completeness: [
        'function signature',
        'try-catch block',
        'return value on success',
        'return value on error',
        'usage example',
        'TypeScript types'
      ],
      clarity: [
        'clear function name',
        'comments explaining approach',
        'example showing both success and failure'
      ],
      errorHandling: [
        'try-catch present',
        'error logged or returned',
        'safe fallback value',
        'handles all JSON.parse errors'
      ]
    }
  },

  // API design
  {
    id: 'code-api-001',
    category: 'code',
    prompt: 'Design a REST API endpoint for creating a new blog post',
    expectedElements: [
      'POST',
      'endpoint',
      'body',
      'validation',
      'response',
      'status',
      'error'
    ],
    qualityCriteria: {
      correctness: [
        'uses POST method',
        'appropriate endpoint path',
        'correct status codes',
        'proper request/response structure'
      ],
      completeness: [
        'HTTP method',
        'endpoint URL',
        'request body schema',
        'response schema',
        'success status code',
        'error status codes',
        'authentication mention',
        'validation requirements'
      ],
      clarity: [
        'clear endpoint naming',
        'structured explanation',
        'example request/response',
        'easy to implement'
      ],
      errorHandling: [
        'error status codes listed',
        'validation errors described',
        'error response format',
        'handles edge cases'
      ]
    }
  },

  // Explanation - Advanced concept
  {
    id: 'explain-advanced-001',
    category: 'explanation',
    prompt: 'What is the difference between OAuth2 and JWT?',
    expectedElements: [
      'OAuth2',
      'JWT',
      'authentication',
      'authorization',
      'token',
      'protocol'
    ],
    qualityCriteria: {
      correctness: [
        'OAuth2 is authorization protocol',
        'JWT is token format',
        'different purposes explained',
        'can be used together'
      ],
      completeness: [
        'OAuth2 definition',
        'JWT definition',
        'key differences',
        'use cases for each',
        'how they can work together',
        'security considerations'
      ],
      clarity: [
        'clear comparison',
        'avoids confusion',
        'structured explanation',
        'examples or analogies'
      ],
      errorHandling: [
        'mentions security considerations',
        'mentions common mistakes',
        'mentions validation'
      ]
    }
  }
];

/**
 * Evaluate a single response against expected criteria
 */
export function evaluateResponse(
  prompt: EvaluationPrompt,
  response: string
): EvaluationResult {
  const responseLower = response.toLowerCase();
  
  // Check for expected elements
  const foundElements: string[] = [];
  const missingElements: string[] = [];
  
  for (const element of prompt.expectedElements) {
    if (responseLower.includes(element.toLowerCase())) {
      foundElements.push(element);
    } else {
      missingElements.push(element);
    }
  }
  
  // Structural analysis
  const hasCodeBlock = /```[\s\S]*?```/.test(response);
  const hasExamples = /example|usage|demo/i.test(response);
  const hasErrorHandling = /try|catch|error|throw|null|undefined|validation/i.test(response);
  
  // Calculate scores
  const scores = {
    correctness: calculateCorrectnessScore(prompt, response, foundElements),
    completeness: calculateCompletenessScore(prompt, response, foundElements, hasCodeBlock, hasExamples),
    clarity: calculateClarityScore(response, hasCodeBlock, hasExamples),
    errorHandling: calculateErrorHandlingScore(prompt, response, hasErrorHandling),
    overall: 0
  };
  
  // Overall is weighted average
  scores.overall = Math.round(
    scores.correctness * 0.35 +
    scores.completeness * 0.30 +
    scores.clarity * 0.20 +
    scores.errorHandling * 0.15
  );
  
  return {
    promptId: prompt.id,
    category: prompt.category,
    response,
    scores,
    foundElements,
    missingElements,
    responseLength: response.length,
    hasCodeBlock,
    hasExamples,
    hasErrorHandling,
    timestamp: new Date().toISOString()
  };
}

/**
 * Calculate correctness score based on found elements and criteria
 */
function calculateCorrectnessScore(
  prompt: EvaluationPrompt,
  response: string,
  foundElements: string[]
): number {
  const responseLower = response.toLowerCase();
  
  // Check correctness criteria
  const criteriaMet = prompt.qualityCriteria.correctness.filter(criterion =>
    responseLower.includes(criterion.toLowerCase().split(' ').find(w => w.length > 4) || criterion.toLowerCase())
  ).length;
  
  const criteriaScore = (criteriaMet / prompt.qualityCriteria.correctness.length) * 100;
  const elementScore = (foundElements.length / prompt.expectedElements.length) * 100;
  
  // Weighted average: 60% criteria, 40% elements
  return Math.round(criteriaScore * 0.6 + elementScore * 0.4);
}

/**
 * Calculate completeness score
 */
function calculateCompletenessScore(
  prompt: EvaluationPrompt,
  response: string,
  foundElements: string[],
  hasCodeBlock: boolean,
  hasExamples: boolean
): number {
  const responseLower = response.toLowerCase();
  
  // Check completeness criteria
  const criteriaMet = prompt.qualityCriteria.completeness.filter(criterion =>
    responseLower.includes(criterion.toLowerCase().split(' ').find(w => w.length > 4) || criterion.toLowerCase())
  ).length;
  
  let score = (criteriaMet / prompt.qualityCriteria.completeness.length) * 70;
  
  // Bonus points for structural completeness
  if (prompt.category === 'code' && hasCodeBlock) score += 15;
  if (hasExamples) score += 15;
  
  return Math.min(100, Math.round(score));
}

/**
 * Calculate clarity score
 */
function calculateClarityScore(
  response: string,
  hasCodeBlock: boolean,
  hasExamples: boolean
): number {
  let score = 50; // Base score
  
  // Check for clear structure
  const hasHeaders = /^#{1,3}\s/m.test(response);
  const hasBulletPoints = /^[*-]\s/m.test(response);
  const hasNumberedList = /^\d+\.\s/m.test(response);
  const paragraphs = response.split('\n\n').length;
  const avgParagraphLength = response.length / Math.max(paragraphs, 1);
  
  if (hasHeaders) score += 10;
  if (hasBulletPoints || hasNumberedList) score += 10;
  if (hasCodeBlock) score += 10;
  if (hasExamples) score += 10;
  if (avgParagraphLength < 500) score += 10; // Not too dense
  
  return Math.min(100, score);
}

/**
 * Calculate error handling score
 */
function calculateErrorHandlingScore(
  prompt: EvaluationPrompt,
  response: string,
  hasErrorHandling: boolean
): number {
  const responseLower = response.toLowerCase();
  
  // Check error handling criteria
  const criteriaMet = prompt.qualityCriteria.errorHandling.filter(criterion =>
    responseLower.includes(criterion.toLowerCase().split(' ').find(w => w.length > 4) || criterion.toLowerCase())
  ).length;
  
  let score = (criteriaMet / Math.max(prompt.qualityCriteria.errorHandling.length, 1)) * 80;
  
  // Bonus if error handling present
  if (hasErrorHandling) score += 20;
  
  return Math.min(100, Math.round(score));
}

/**
 * Run full evaluation suite
 */
export async function runEvaluationSuite(
  chatFunction: (prompt: string, mode?: string) => Promise<string>,
  mode: string = 'chat'
): Promise<{
  results: EvaluationResult[];
  aggregate: AggregateEvaluation;
}> {
  const results: EvaluationResult[] = [];
  
  console.log(`Starting evaluation suite with ${EVALUATION_PROMPTS.length} prompts...`);
  
  for (const prompt of EVALUATION_PROMPTS) {
    console.log(`Evaluating: ${prompt.id} - ${prompt.prompt.substring(0, 60)}...`);
    
    try {
      const response = await chatFunction(prompt.prompt, mode);
      const result = evaluateResponse(prompt, response);
      results.push(result);
      
      console.log(`  Overall Score: ${result.scores.overall}/100`);
    } catch (error) {
      console.error(`  Error evaluating ${prompt.id}:`, error);
      // Create a failed result
      results.push({
        promptId: prompt.id,
        category: prompt.category,
        response: `ERROR: ${error}`,
        scores: { correctness: 0, completeness: 0, clarity: 0, errorHandling: 0, overall: 0 },
        foundElements: [],
        missingElements: prompt.expectedElements,
        responseLength: 0,
        hasCodeBlock: false,
        hasExamples: false,
        hasErrorHandling: false,
        timestamp: new Date().toISOString()
      });
    }
  }
  
  // Calculate aggregate statistics
  const aggregate = calculateAggregateStats(results);
  
  return { results, aggregate };
}

/**
 * Calculate aggregate statistics from results
 */
function calculateAggregateStats(results: EvaluationResult[]): AggregateEvaluation {
  const categoryMap = new Map<string, number[]>();
  
  for (const result of results) {
    if (!categoryMap.has(result.category)) {
      categoryMap.set(result.category, []);
    }
    categoryMap.get(result.category)!.push(result.scores.overall);
  }
  
  const categoryBreakdown: { [category: string]: { count: number; averageScore: number } } = {};
  
  for (const [category, scores] of categoryMap) {
    categoryBreakdown[category] = {
      count: scores.length,
      averageScore: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    };
  }
  
  const averageScores = {
    correctness: Math.round(results.reduce((sum, r) => sum + r.scores.correctness, 0) / results.length),
    completeness: Math.round(results.reduce((sum, r) => sum + r.scores.completeness, 0) / results.length),
    clarity: Math.round(results.reduce((sum, r) => sum + r.scores.clarity, 0) / results.length),
    errorHandling: Math.round(results.reduce((sum, r) => sum + r.scores.errorHandling, 0) / results.length),
    overall: Math.round(results.reduce((sum, r) => sum + r.scores.overall, 0) / results.length)
  };
  
  return {
    totalPrompts: results.length,
    averageScores,
    categoryBreakdown,
    timestamp: new Date().toISOString()
  };
}

/**
 * Compare two evaluation runs
 */
export function compareEvaluations(
  baseline: AggregateEvaluation,
  improved: AggregateEvaluation
): {
  improvements: {
    correctness: number;
    completeness: number;
    clarity: number;
    errorHandling: number;
    overall: number;
  };
  summary: string;
} {
  const improvements = {
    correctness: improved.averageScores.correctness - baseline.averageScores.correctness,
    completeness: improved.averageScores.completeness - baseline.averageScores.completeness,
    clarity: improved.averageScores.clarity - baseline.averageScores.clarity,
    errorHandling: improved.averageScores.errorHandling - baseline.averageScores.errorHandling,
    overall: improved.averageScores.overall - baseline.averageScores.overall
  };
  
  const summary = `
Quality Improvement Summary:
- Correctness: ${improvements.correctness >= 0 ? '+' : ''}${improvements.correctness} points (${baseline.averageScores.correctness} → ${improved.averageScores.correctness})
- Completeness: ${improvements.completeness >= 0 ? '+' : ''}${improvements.completeness} points (${baseline.averageScores.completeness} → ${improved.averageScores.completeness})
- Clarity: ${improvements.clarity >= 0 ? '+' : ''}${improvements.clarity} points (${baseline.averageScores.clarity} → ${improved.averageScores.clarity})
- Error Handling: ${improvements.errorHandling >= 0 ? '+' : ''}${improvements.errorHandling} points (${baseline.averageScores.errorHandling} → ${improved.averageScores.errorHandling})
- Overall: ${improvements.overall >= 0 ? '+' : ''}${improvements.overall} points (${baseline.averageScores.overall} → ${improved.averageScores.overall})
`.trim();
  
  return { improvements, summary };
}

/**
 * Export results to JSON file
 */
export function exportEvaluationResults(
  results: EvaluationResult[],
  aggregate: AggregateEvaluation,
  filename: string
): string {
  const data = {
    metadata: {
      timestamp: new Date().toISOString(),
      totalPrompts: results.length,
      version: '1.0.0'
    },
    aggregate,
    results
  };
  
  return JSON.stringify(data, null, 2);
}
