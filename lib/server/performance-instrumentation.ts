/**
 * Performance instrumentation for SWARM AI
 * Tracks timing, throughput, and latency metrics across the request pipeline
 * to establish baselines and measure optimization improvements.
 */

export interface PerformanceMetrics {
  // Request lifecycle timing
  requestReceived: number;
  authCompleted?: number;
  usageReserved?: number;
  modelDiscoveryStarted?: number;
  modelDiscoveryCompleted?: number;
  routingStarted?: number;
  routingCompleted?: number;
  providerRequestStarted?: number;
  firstTokenReceived?: number;
  streamingCompleted?: number;
  usageSettled?: number;
  requestCompleted: number;

  // Derived metrics (calculated on finalize)
  totalDuration?: number;
  authLatency?: number;
  usageCheckLatency?: number;
  modelDiscoveryLatency?: number;
  routingLatency?: number;
  providerTTFT?: number; // Time To First Token from provider
  streamingDuration?: number;
  overheadLatency?: number; // Non-provider time
  
  // Request metadata
  requestId: string;
  owner: string;
  mode: 'chat' | 'swarm';
  modelId: string;
  providerId?: string;
  automatic: boolean;
  
  // Provider metrics
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  
  // Outcome
  success: boolean;
  errorCategory?: string;
  retryCount?: number;
}

export interface AggregateMetrics {
  // Timing percentiles (milliseconds)
  p50_totalDuration: number;
  p90_totalDuration: number;
  p99_totalDuration: number;
  p50_ttft: number;
  p90_ttft: number;
  p99_ttft: number;
  p50_overheadLatency: number;
  p90_overheadLatency: number;
  
  // Throughput
  requestsPerMinute: number;
  tokensPerSecond: number;
  
  // Success rates
  successRate: number;
  timeoutRate: number;
  providerErrorRate: number;
  
  // Sample size and time range
  sampleSize: number;
  timeRangeMs: number;
  oldestTimestamp: number;
  newestTimestamp: number;
}

class PerformanceTracker {
  private metrics: Map<string, PerformanceMetrics> = new Map();
  private readonly maxStoredMetrics = 1000;
  private readonly retentionMs = 3600000; // 1 hour

  startRequest(requestId: string, owner: string, mode: 'chat' | 'swarm', modelId: string, automatic: boolean): void {
    const now = Date.now();
    this.metrics.set(requestId, {
      requestReceived: now,
      requestCompleted: 0,
      requestId,
      owner,
      mode,
      modelId,
      automatic,
      success: false,
    });
    this.cleanup();
  }

  recordTimestamp(requestId: string, event: keyof PerformanceMetrics): void {
    const metric = this.metrics.get(requestId);
    if (!metric) return;
    (metric as any)[event] = Date.now();
  }

  recordProviderMetrics(requestId: string, promptTokens: number, completionTokens: number, providerId: string): void {
    const metric = this.metrics.get(requestId);
    if (!metric) return;
    metric.promptTokens = promptTokens;
    metric.completionTokens = completionTokens;
    metric.totalTokens = promptTokens + completionTokens;
    metric.providerId = providerId;
  }

  recordError(requestId: string, category: string): void {
    const metric = this.metrics.get(requestId);
    if (!metric) return;
    metric.errorCategory = category;
    metric.success = false;
  }

  recordSuccess(requestId: string): void {
    const metric = this.metrics.get(requestId);
    if (!metric) return;
    metric.success = true;
  }

  finalizeRequest(requestId: string): PerformanceMetrics | null {
    const metric = this.metrics.get(requestId);
    if (!metric) return null;

    const now = Date.now();
    metric.requestCompleted = now;

    // Calculate derived metrics
    metric.totalDuration = metric.requestCompleted - metric.requestReceived;
    
    if (metric.authCompleted) {
      metric.authLatency = metric.authCompleted - metric.requestReceived;
    }
    
    if (metric.usageReserved && metric.authCompleted) {
      metric.usageCheckLatency = metric.usageReserved - metric.authCompleted;
    }
    
    if (metric.modelDiscoveryCompleted && metric.modelDiscoveryStarted) {
      metric.modelDiscoveryLatency = metric.modelDiscoveryCompleted - metric.modelDiscoveryStarted;
    }
    
    if (metric.routingCompleted && metric.routingStarted) {
      metric.routingLatency = metric.routingCompleted - metric.routingStarted;
    }
    
    if (metric.firstTokenReceived && metric.providerRequestStarted) {
      metric.providerTTFT = metric.firstTokenReceived - metric.providerRequestStarted;
    }
    
    if (metric.streamingCompleted && metric.firstTokenReceived) {
      metric.streamingDuration = metric.streamingCompleted - metric.firstTokenReceived;
    }
    
    // Calculate overhead (all non-provider time)
    const providerTime = metric.providerTTFT && metric.streamingDuration 
      ? metric.providerTTFT + metric.streamingDuration 
      : 0;
    metric.overheadLatency = metric.totalDuration - providerTime;

    return metric;
  }

  getMetrics(requestId: string): PerformanceMetrics | null {
    return this.metrics.get(requestId) || null;
  }

  getAllMetrics(): PerformanceMetrics[] {
    return Array.from(this.metrics.values());
  }

  getAggregateMetrics(windowMs: number = 600000): AggregateMetrics | null {
    const now = Date.now();
    const cutoff = now - windowMs;
    
    const recentMetrics = Array.from(this.metrics.values())
      .filter(m => m.requestCompleted > cutoff && m.requestCompleted > 0)
      .sort((a, b) => a.requestReceived - b.requestReceived);

    if (recentMetrics.length === 0) return null;

    // Calculate percentiles
    const percentile = (arr: number[], p: number): number => {
      if (arr.length === 0) return 0;
      const sorted = [...arr].sort((a, b) => a - b);
      const index = Math.ceil((p / 100) * sorted.length) - 1;
      return sorted[Math.max(0, index)];
    };

    const totalDurations = recentMetrics.map(m => m.totalDuration || 0).filter(d => d > 0);
    const ttfts = recentMetrics.map(m => m.providerTTFT || 0).filter(t => t > 0);
    const overheadLatencies = recentMetrics.map(m => m.overheadLatency || 0).filter(o => o > 0);

    // Calculate rates
    const timeRangeMs = recentMetrics[recentMetrics.length - 1].requestCompleted - recentMetrics[0].requestReceived;
    const requestsPerMinute = timeRangeMs > 0 ? (recentMetrics.length / timeRangeMs) * 60000 : 0;

    const totalTokens = recentMetrics.reduce((sum, m) => sum + (m.totalTokens || 0), 0);
    const tokensPerSecond = timeRangeMs > 0 ? (totalTokens / timeRangeMs) * 1000 : 0;

    // Calculate success rates
    const successCount = recentMetrics.filter(m => m.success).length;
    const timeoutCount = recentMetrics.filter(m => m.errorCategory === 'timeout').length;
    const providerErrorCount = recentMetrics.filter(m => ['auth', 'quota', 'rate_limit', 'network'].includes(m.errorCategory || '')).length;

    return {
      p50_totalDuration: percentile(totalDurations, 50),
      p90_totalDuration: percentile(totalDurations, 90),
      p99_totalDuration: percentile(totalDurations, 99),
      p50_ttft: percentile(ttfts, 50),
      p90_ttft: percentile(ttfts, 90),
      p99_ttft: percentile(ttfts, 99),
      p50_overheadLatency: percentile(overheadLatencies, 50),
      p90_overheadLatency: percentile(overheadLatencies, 90),
      requestsPerMinute,
      tokensPerSecond,
      successRate: recentMetrics.length > 0 ? successCount / recentMetrics.length : 0,
      timeoutRate: recentMetrics.length > 0 ? timeoutCount / recentMetrics.length : 0,
      providerErrorRate: recentMetrics.length > 0 ? providerErrorCount / recentMetrics.length : 0,
      sampleSize: recentMetrics.length,
      timeRangeMs,
      oldestTimestamp: recentMetrics[0].requestReceived,
      newestTimestamp: recentMetrics[recentMetrics.length - 1].requestCompleted,
    };
  }

  exportMetrics(): string {
    const all = this.getAllMetrics();
    const aggregate = this.getAggregateMetrics();
    
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      aggregate,
      individual: all.map(m => ({
        requestId: m.requestId,
        mode: m.mode,
        modelId: m.modelId,
        providerId: m.providerId,
        automatic: m.automatic,
        totalDuration: m.totalDuration,
        authLatency: m.authLatency,
        usageCheckLatency: m.usageCheckLatency,
        routingLatency: m.routingLatency,
        providerTTFT: m.providerTTFT,
        streamingDuration: m.streamingDuration,
        overheadLatency: m.overheadLatency,
        promptTokens: m.promptTokens,
        completionTokens: m.completionTokens,
        success: m.success,
        errorCategory: m.errorCategory,
      })),
    }, null, 2);
  }

  private cleanup(): void {
    if (this.metrics.size <= this.maxStoredMetrics) return;

    const now = Date.now();
    const cutoff = now - this.retentionMs;
    
    // Remove old metrics
    for (const [id, metric] of this.metrics.entries()) {
      if (metric.requestCompleted > 0 && metric.requestCompleted < cutoff) {
        this.metrics.delete(id);
      }
    }

    // If still too many, remove oldest completed requests
    if (this.metrics.size > this.maxStoredMetrics) {
      const completed = Array.from(this.metrics.entries())
        .filter(([_, m]) => m.requestCompleted > 0)
        .sort(([_, a], [__, b]) => a.requestCompleted - b.requestCompleted);
      
      const toRemove = completed.slice(0, completed.length - this.maxStoredMetrics);
      for (const [id] of toRemove) {
        this.metrics.delete(id);
      }
    }
  }

  clear(): void {
    this.metrics.clear();
  }
}

// Singleton instance
const globalTracker = new PerformanceTracker();

export const performanceTracker = globalTracker;

/**
 * Utility to measure execution time of async operations
 */
export async function measureAsync<T>(
  label: string,
  operation: () => Promise<T>
): Promise<{ result: T; durationMs: number }> {
  const start = Date.now();
  try {
    const result = await operation();
    const durationMs = Date.now() - start;
    return { result, durationMs };
  } catch (error) {
    const durationMs = Date.now() - start;
    throw error;
  }
}

/**
 * Format metrics for logging (without exposing sensitive data)
 */
export function formatMetricsForLog(metrics: PerformanceMetrics): string {
  return `[${metrics.requestId.slice(0, 8)}] ${metrics.mode} ${metrics.success ? 'SUCCESS' : 'FAILED'} ` +
    `total=${metrics.totalDuration}ms ttft=${metrics.providerTTFT || 'N/A'}ms ` +
    `overhead=${metrics.overheadLatency}ms model=${metrics.modelId}`;
}
