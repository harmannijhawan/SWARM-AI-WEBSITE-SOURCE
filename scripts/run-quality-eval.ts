#!/usr/bin/env tsx
/**
 * Quality Evaluation Runner
 * 
 * Runs the quality evaluation suite and outputs results.
 * Can be used to capture baseline or post-improvement metrics.
 * 
 * Usage:
 *   npm run eval:quality -- --mode baseline
 *   npm run eval:quality -- --mode improved
 *   npm run eval:quality -- --compare baseline.json improved.json
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
  runEvaluationSuite,
  compareEvaluations,
  exportEvaluationResults,
  type AggregateEvaluation
} from '../lib/server/quality-evaluation';

// Mock chat function that uses the actual backend
// In a real scenario, this would call the deployed API or run the backend directly
async function mockChatFunction(prompt: string, mode: string = 'chat'): Promise<string> {
  // For testing purposes, we'll simulate different quality levels
  // In production, this should call the actual API endpoint
  
  // This is a placeholder - in real evaluation, you would:
  // 1. Start the dev server
  // 2. Make actual HTTP requests to /api/chat
  // 3. Capture real responses
  
  console.warn('⚠️  Using mock responses. For real evaluation, integrate with actual API.');
  
  // Return a mock response that varies by prompt type
  if (prompt.includes('email')) {
    return `# Email Validation Function

Here's a TypeScript function to validate email addresses:

\`\`\`typescript
export function validateEmail(email: string | null | undefined): boolean {
  // Handle null/undefined input
  if (!email) {
    return false;
  }
  
  // Email regex pattern (RFC 5322 simplified)
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$/;
  
  return emailRegex.test(email);
}
\`\`\`

**Usage Example:**
\`\`\`typescript
console.log(validateEmail('user@example.com')); // true
console.log(validateEmail('invalid.email'));     // false
console.log(validateEmail(null));                 // false
\`\`\`

**Test Cases:**
- Valid: \`user@example.com\`, \`first.last@domain.co.uk\`
- Invalid: \`@example.com\`, \`user@\`, \`plain text\`, \`null\`, \`undefined\`
`;
  }
  
  return 'This is a mock response. Please integrate with actual backend for real evaluation.';
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  if (command === '--compare' && args.length === 3) {
    // Compare two evaluation files
    const baselinePath = args[1];
    const improvedPath = args[2];
    
    if (!existsSync(baselinePath) || !existsSync(improvedPath)) {
      console.error('❌ One or both evaluation files not found');
      process.exit(1);
    }
    
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf-8'));
    const improved = JSON.parse(readFileSync(improvedPath, 'utf-8'));
    
    const comparison = compareEvaluations(baseline.aggregate, improved.aggregate);
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 QUALITY EVALUATION COMPARISON');
    console.log('='.repeat(60));
    console.log(comparison.summary);
    console.log('='.repeat(60) + '\n');
    
    // Determine overall result
    if (comparison.improvements.overall > 0) {
      console.log('✅ Overall quality improved by', comparison.improvements.overall, 'points');
    } else if (comparison.improvements.overall < 0) {
      console.log('⚠️  Overall quality decreased by', Math.abs(comparison.improvements.overall), 'points');
    } else {
      console.log('➡️  Overall quality unchanged');
    }
    
    return;
  }
  
  // Run evaluation
  const mode = command === '--mode' ? args[1] : 'test';
  
  console.log('\n' + '='.repeat(60));
  console.log(`📊 RUNNING QUALITY EVALUATION (${mode.toUpperCase()} MODE)`);
  console.log('='.repeat(60) + '\n');
  
  const startTime = Date.now();
  const { results, aggregate } = await runEvaluationSuite(mockChatFunction);
  const duration = Date.now() - startTime;
  
  // Display results
  console.log('\n' + '='.repeat(60));
  console.log('📊 EVALUATION RESULTS');
  console.log('='.repeat(60));
  console.log(`Total Prompts: ${aggregate.totalPrompts}`);
  console.log(`Duration: ${(duration / 1000).toFixed(2)}s`);
  console.log('');
  console.log('Average Scores:');
  console.log(`  Correctness:     ${aggregate.averageScores.correctness}/100`);
  console.log(`  Completeness:    ${aggregate.averageScores.completeness}/100`);
  console.log(`  Clarity:         ${aggregate.averageScores.clarity}/100`);
  console.log(`  Error Handling:  ${aggregate.averageScores.errorHandling}/100`);
  console.log(`  Overall:         ${aggregate.averageScores.overall}/100`);
  console.log('');
  console.log('Category Breakdown:');
  for (const [category, stats] of Object.entries(aggregate.categoryBreakdown)) {
    console.log(`  ${category}: ${stats.averageScore}/100 (${stats.count} prompts)`);
  }
  console.log('='.repeat(60) + '\n');
  
  // Save results
  const outputDir = join(process.cwd(), 'swarm-ai-website-design', '.evaluation');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `evaluation-${mode}-${timestamp}.json`;
  const filepath = join(outputDir, filename);
  
  // Create output directory if it doesn't exist
  try {
    const { mkdirSync } = await import('fs');
    mkdirSync(outputDir, { recursive: true });
  } catch (err) {
    // Directory might already exist
  }
  
  const exportData = exportEvaluationResults(results, aggregate, filename);
  writeFileSync(filepath, exportData);
  
  console.log(`💾 Results saved to: ${filepath}`);
  console.log(`\nTo compare with another run:`);
  console.log(`  npm run eval:quality -- --compare ${filepath} <other-file.json>\n`);
  
  // Show top and bottom performers
  const sortedResults = [...results].sort((a, b) => b.scores.overall - a.scores.overall);
  
  console.log('🏆 Top 3 Performers:');
  sortedResults.slice(0, 3).forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.promptId} - ${r.scores.overall}/100`);
  });
  
  console.log('\n⚠️  Bottom 3 Performers:');
  sortedResults.slice(-3).reverse().forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.promptId} - ${r.scores.overall}/100`);
  });
  
  console.log('');
}

main().catch(error => {
  console.error('❌ Error running evaluation:', error);
  process.exit(1);
});
