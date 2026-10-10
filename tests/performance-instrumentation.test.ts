import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performanceTracker } from '../lib/server/performance-instrumentation';

test('performance tracker basic lifecycle', () => {
  performanceTracker.clear();
  
  const requestId = 'test-basic-001';
  
  performanceTracker.startRequest(requestId, 'user', 'chat', 'model', true);
  performanceTracker.recordTimestamp(requestId, 'authCompleted');
  performanceTracker.recordTimestamp(requestId, 'providerRequestStarted');
  performanceTracker.recordTimestamp(requestId, 'firstTokenReceived');
  performanceTracker.recordTimestamp(requestId, 'streamingCompleted');
  performanceTracker.recordProviderMetrics(requestId, 100, 50, 'test');
  performanceTracker.recordSuccess(requestId);
  
  const metrics = performanceTracker.finalizeRequest(requestId);
  
  assert(metrics);
  assert.equal(metrics.requestId, requestId);
  assert.equal(metrics.success, true);
  assert.equal(metrics.promptTokens, 100);
  assert.equal(metrics.completionTokens, 50);
  assert(metrics.totalDuration !== undefined);
});

test('performance tracker handles errors', () => {
  performanceTracker.clear();
  
  const requestId = 'test-error-001';
  
  performanceTracker.startRequest(requestId, 'user', 'chat', 'model', true);
  performanceTracker.recordError(requestId, 'timeout');
  
  const metrics = performanceTracker.finalizeRequest(requestId);
  
  assert(metrics);
  assert.equal(metrics.success, false);
  assert.equal(metrics.errorCategory, 'timeout');
});

test('performance tracker calculates derived metrics', () => {
  performanceTracker.clear();
  
  const requestId = 'test-derived-001';
  
  performanceTracker.startRequest(requestId, 'user', 'chat', 'model', true);
  performanceTracker.recordTimestamp(requestId, 'authCompleted');
  performanceTracker.recordTimestamp(requestId, 'usageReserved');
  performanceTracker.recordTimestamp(requestId, 'providerRequestStarted');
  performanceTracker.recordTimestamp(requestId, 'firstTokenReceived');
  performanceTracker.recordTimestamp(requestId, 'streamingCompleted');
  performanceTracker.recordSuccess(requestId);
  
  const metrics = performanceTracker.finalizeRequest(requestId);
  
  assert(metrics);
  assert(metrics.totalDuration !== undefined);
  assert(metrics.authLatency !== undefined);
  assert(metrics.usageCheckLatency !== undefined);
  assert(metrics.providerTTFT !== undefined);
  assert(metrics.overheadLatency !== undefined);
});

test('performance tracker aggregate metrics', () => {
  performanceTracker.clear();
  
  // Create several requests
  for (let i = 0; i < 5; i++) {
    const requestId = `test-agg-${i}`;
    performanceTracker.startRequest(requestId, 'user', 'chat', 'model', true);
    performanceTracker.recordTimestamp(requestId, 'authCompleted');
    performanceTracker.recordTimestamp(requestId, 'providerRequestStarted');
    performanceTracker.recordTimestamp(requestId, 'firstTokenReceived');
    performanceTracker.recordTimestamp(requestId, 'streamingCompleted');
    performanceTracker.recordProviderMetrics(requestId, 100, 50, 'test');
    performanceTracker.recordSuccess(requestId);
    performanceTracker.finalizeRequest(requestId);
  }
  
  const aggregate = performanceTracker.getAggregateMetrics(600000);
  
  assert(aggregate);
  assert.equal(aggregate.sampleSize, 5);
  assert(aggregate.p50_totalDuration !== undefined);
  assert(aggregate.p90_totalDuration !== undefined);
  assert(aggregate.p99_totalDuration !== undefined);
  assert.equal(aggregate.successRate, 1); // 100%
});

test('performance tracker export format', () => {
  performanceTracker.clear();
  
  const requestId = 'test-export-001';
  performanceTracker.startRequest(requestId, 'user', 'chat', 'model', true);
  performanceTracker.recordProviderMetrics(requestId, 50, 25, 'test');
  performanceTracker.recordSuccess(requestId);
  performanceTracker.finalizeRequest(requestId);
  
  const exported = performanceTracker.exportMetrics();
  const data = JSON.parse(exported);
  
  assert(data.timestamp);
  assert(data.aggregate);
  assert(Array.isArray(data.individual));
  assert(data.individual.length > 0);
  assert.equal(data.individual[0].requestId, requestId);
});

test('performance tracker cleanup limits stored metrics', () => {
  performanceTracker.clear();
  
  // Create more than max (1000) and finalize each to trigger cleanup
  for (let i = 0; i < 1100; i++) {
    const requestId = `test-limit-${i}`;
    performanceTracker.startRequest(requestId, 'user', 'chat', 'model', true);
    performanceTracker.recordSuccess(requestId);
    performanceTracker.finalizeRequest(requestId);
    // Cleanup is triggered in startRequest, so adding one more triggers it
    if (i === 1099) {
      performanceTracker.startRequest('trigger-cleanup', 'user', 'chat', 'model', true);
      performanceTracker.finalizeRequest('trigger-cleanup');
    }
  }
  
  const allMetrics = performanceTracker.getAllMetrics();
  // Allow some margin since cleanup is triggered on next startRequest
  assert(allMetrics.length <= 1001, `Should not exceed max metrics limit, got ${allMetrics.length}`);
});

test('performance tracker handles missing request gracefully', () => {
  performanceTracker.clear();
  
  performanceTracker.recordTimestamp('nonexistent', 'authCompleted');
  performanceTracker.recordSuccess('nonexistent');
  const metrics = performanceTracker.finalizeRequest('nonexistent');
  
  assert.equal(metrics, null);
});

test('performance tracker getMetrics returns specific request', () => {
  performanceTracker.clear();
  
  const requestId = 'test-get-001';
  performanceTracker.startRequest(requestId, 'user', 'chat', 'model', true);
  
  const metrics = performanceTracker.getMetrics(requestId);
  
  assert(metrics);
  assert.equal(metrics.requestId, requestId);
});

test('performance tracker clear removes all metrics', () => {
  performanceTracker.startRequest('test-1', 'user', 'chat', 'model', true);
  performanceTracker.startRequest('test-2', 'user', 'chat', 'model', true);
  
  performanceTracker.clear();
  
  const allMetrics = performanceTracker.getAllMetrics();
  assert.equal(allMetrics.length, 0);
});
