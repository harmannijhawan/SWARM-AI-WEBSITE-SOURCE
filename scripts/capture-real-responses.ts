#!/usr/bin/env tsx
/**
 * Real Response Capture Tool
 * 
 * Captures real responses from the SWARM API for quality evaluation.
 * Run this against a live backend to get actual responses.
 * 
 * Usage:
 *   1. Start backend: npm run dev
 *   2. Set environment variables:
 *      export SWARM_API_URL=http://localhost:3000
 *      export SWARM_AUTH_TOKEN=your_token_here
 *   3. Run capture: npm run capture:responses -- --mode baseline
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { EVALUATION_PROMPTS, evaluateResponse, type EvaluationResult } from '../lib/server/quality-evaluation';

interface CaptureConfig {
  apiUrl: string;
  authToken?: string;
  mode: string;
}

async function captureResponse(
  prompt: string,
  config: CaptureConfig
): Promise<string> {
  try {
    const response = await fetch(`${config.apiUrl}/api/managed/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.authToken ? { 'Authorization': `Bearer ${config.authToken}` } : {})
      },
      body: JSON.stringify({
        conversationId: `eval-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        requestId: `req-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        input: prompt,
        mode: 'chat'
      })
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    // Read streaming response
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let fullResponse = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.substring(6));
            if (data.token) {
              fullResponse += data.token;
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }
    }

    return fullResponse || 'No response captured';
  } catch (error) {
    console.error(`Error capturing response:`, error);
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const modeIndex = args.indexOf('--mode');
  const mode = modeIndex >= 0 ? args[modeIndex + 1] : 'test';

  const config: CaptureConfig = {
    apiUrl: process.env.SWARM_API_URL || 'http://localhost:3000',
    authToken: process.env.SWARM_AUTH_TOKEN,
    mode
  };

  console.log('\n' + '='.repeat(60));
  console.log(`📡 CAPTURING REAL RESPONSES (${mode.toUpperCase()} MODE)`);
  console.log('='.repeat(60));
  console.log(`API URL: ${config.apiUrl}`);
  console.log(`Auth: ${config.authToken ? 'Configured' : 'None (using guest/anonymous)'}`);
  console.log(`Total Prompts: ${EVALUATION_PROMPTS.length}\n`);

  // Test API connectivity
  console.log('Testing API connectivity...');
  try {
    const testResponse = await fetch(`${config.apiUrl}/api/health`);
    if (!testResponse.ok) {
      console.warn('⚠️  API health check failed, but continuing anyway...');
    } else {
      console.log('✅ API is reachable\n');
    }
  } catch (error) {
    console.error('❌ Cannot reach API. Is the server running?');
    console.error(`   Expected URL: ${config.apiUrl}`);
    console.error(`   Error: ${error}`);
    process.exit(1);
  }

  const results: EvaluationResult[] = [];
  const startTime = Date.now();

  for (let i = 0; i < EVALUATION_PROMPTS.length; i++) {
    const prompt = EVALUATION_PROMPTS[i];
    console.log(`[${i + 1}/${EVALUATION_PROMPTS.length}] ${prompt.id}`);
    console.log(`   Prompt: ${prompt.prompt.substring(0, 60)}...`);

    try {
      console.log(`   Sending request...`);
      const response = await captureResponse(prompt.prompt, config);
      
      console.log(`   Response length: ${response.length} chars`);
      
      const result = evaluateResponse(prompt, response);
      results.push(result);
      
      console.log(`   Overall Score: ${result.scores.overall}/100`);
      console.log(`   ✓ Captured\n`);

      // Add small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(`   ❌ Failed: ${error}\n`);
      
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

  const duration = Date.now() - startTime;

  // Calculate aggregate statistics
  const totalPrompts = results.length;
  const successfulResults = results.filter(r => r.scores.overall > 0);
  const failedCount = totalPrompts - successfulResults.length;

  const averageScores = successfulResults.length > 0 ? {
    correctness: Math.round(successfulResults.reduce((sum, r) => sum + r.scores.correctness, 0) / successfulResults.length),
    completeness: Math.round(successfulResults.reduce((sum, r) => sum + r.scores.completeness, 0) / successfulResults.length),
    clarity: Math.round(successfulResults.reduce((sum, r) => sum + r.scores.clarity, 0) / successfulResults.length),
    errorHandling: Math.round(successfulResults.reduce((sum, r) => sum + r.scores.errorHandling, 0) / successfulResults.length),
    overall: Math.round(successfulResults.reduce((sum, r) => sum + r.scores.overall, 0) / successfulResults.length)
  } : {
    correctness: 0, completeness: 0, clarity: 0, errorHandling: 0, overall: 0
  };

  // Category breakdown
  const categoryMap = new Map<string, number[]>();
  for (const result of successfulResults) {
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

  const aggregate = {
    totalPrompts,
    successfulResponses: successfulResults.length,
    failedResponses: failedCount,
    averageScores,
    categoryBreakdown,
    timestamp: new Date().toISOString()
  };

  // Display results
  console.log('\n' + '='.repeat(60));
  console.log('📊 CAPTURE RESULTS');
  console.log('='.repeat(60));
  console.log(`Total Prompts: ${totalPrompts}`);
  console.log(`Successful: ${successfulResults.length}`);
  console.log(`Failed: ${failedCount}`);
  console.log(`Duration: ${(duration / 1000).toFixed(2)}s`);
  console.log('');
  
  if (successfulResults.length > 0) {
    console.log('Average Scores:');
    console.log(`  Correctness:     ${averageScores.correctness}/100`);
    console.log(`  Completeness:    ${averageScores.completeness}/100`);
    console.log(`  Clarity:         ${averageScores.clarity}/100`);
    console.log(`  Error Handling:  ${averageScores.errorHandling}/100`);
    console.log(`  Overall:         ${averageScores.overall}/100`);
    console.log('');
    console.log('Category Breakdown:');
    for (const [category, stats] of Object.entries(categoryBreakdown)) {
      console.log(`  ${category}: ${stats.averageScore}/100 (${stats.count} prompts)`);
    }
  } else {
    console.log('⚠️  No successful responses captured');
  }
  console.log('='.repeat(60) + '\n');

  // Save results
  const outputDir = join(process.cwd(), 'swarm-ai-website-design', '.evaluation');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const filename = `evaluation-${mode}-${timestamp}.json`;
  const filepath = join(outputDir, filename);

  // Create output directory
  try {
    const { mkdirSync } = await import('fs');
    mkdirSync(outputDir, { recursive: true });
  } catch (err) {
    // Directory might already exist
  }

  const exportData = {
    metadata: {
      timestamp: new Date().toISOString(),
      mode,
      apiUrl: config.apiUrl,
      duration: duration,
      version: '1.0.0'
    },
    aggregate,
    results
  };

  writeFileSync(filepath, JSON.stringify(exportData, null, 2));

  console.log(`💾 Results saved to: ${filepath}`);
  console.log(`\nTo compare with another run:`);
  console.log(`  npm run eval:quality -- --compare ${filepath} <other-file.json>\n`);

  // Show top and bottom performers
  if (successfulResults.length > 0) {
    const sortedResults = [...successfulResults].sort((a, b) => b.scores.overall - a.scores.overall);

    console.log('🏆 Top Performers:');
    sortedResults.slice(0, Math.min(3, sortedResults.length)).forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.promptId} - ${r.scores.overall}/100`);
    });

    if (sortedResults.length > 3) {
      console.log('\n⚠️  Bottom Performers:');
      sortedResults.slice(-Math.min(3, sortedResults.length)).reverse().forEach((r, i) => {
        console.log(`  ${i + 1}. ${r.promptId} - ${r.scores.overall}/100`);
      });
    }
  }

  console.log('');

  if (failedCount > 0) {
    console.log(`⚠️  ${failedCount} prompt(s) failed. Check server logs for details.`);
  }
}

main().catch(error => {
  console.error('❌ Error capturing responses:', error);
  process.exit(1);
});
