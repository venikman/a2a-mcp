/**
 * Latency metrics collection for observability
 *
 * Features:
 * - Per-agent and per-tool latency tracking
 * - Percentile calculations (p50, p95)
 * - Scoped to correlation ID
 */

import type { LatencyStats, RunMetrics } from "./types.js";

/**
 * Collector for latency measurements within a single run
 */
export class MetricsCollector {
  private correlationId: string;
  private startTime: number;
  private agentLatencies: Map<string, number[]> = new Map();
  private toolLatencies: Map<string, number[]> = new Map();

  constructor(correlationId: string) {
    this.correlationId = correlationId;
    this.startTime = Date.now();
  }

  /**
   * Record an agent invocation latency
   */
  recordAgentLatency(agentName: string, durationMs: number): void {
    const latencies = this.agentLatencies.get(agentName) ?? [];
    latencies.push(durationMs);
    this.agentLatencies.set(agentName, latencies);
  }

  /**
   * Record a tool call latency
   */
  recordToolLatency(toolName: string, durationMs: number): void {
    const latencies = this.toolLatencies.get(toolName) ?? [];
    latencies.push(durationMs);
    this.toolLatencies.set(toolName, latencies);
  }

  /**
   * Calculate percentile from sorted array
   */
  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.floor((p / 100) * (sorted.length - 1));
    return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
  }

  /**
   * Calculate latency stats from measurements
   */
  private calculateStats(measurements: number[]): LatencyStats {
    if (measurements.length === 0) {
      return { p50_ms: 0, p95_ms: 0, count: 0 };
    }

    const sorted = [...measurements].sort((a, b) => a - b);
    return {
      p50_ms: this.percentile(sorted, 50),
      p95_ms: this.percentile(sorted, 95),
      count: sorted.length,
    };
  }

  /**
   * Get final run metrics
   */
  getMetrics(): RunMetrics {
    const agentStats: Record<string, LatencyStats> = {};
    for (const [name, latencies] of this.agentLatencies) {
      agentStats[name] = this.calculateStats(latencies);
    }

    const toolStats: Record<string, LatencyStats> = {};
    for (const [name, latencies] of this.toolLatencies) {
      toolStats[name] = this.calculateStats(latencies);
    }

    return {
      correlation_id: this.correlationId,
      total_duration_ms: Date.now() - this.startTime,
      agent_latencies: agentStats,
      tool_latencies: toolStats,
    };
  }
}

/**
 * Create a new metrics collector for a run
 */
export function createMetricsCollector(correlationId: string): MetricsCollector {
  return new MetricsCollector(correlationId);
}

/**
 * Time an async operation and return duration
 */
export async function timeAsync<T>(fn: () => Promise<T>): Promise<{ result: T; durationMs: number }> {
  const start = Date.now();
  const result = await fn();
  return { result, durationMs: Date.now() - start };
}
