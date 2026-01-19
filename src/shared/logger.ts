/**
 * Structured JSON logging for observability
 *
 * Features:
 * - JSON format for log aggregation systems
 * - Log levels: debug, info, warn, error
 * - Correlation ID integration
 * - Duration tracking for timing
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  event: string;
  correlation_id?: string;
  duration_ms?: number;
  data?: Record<string, unknown>;
}

// Log level priority (lower = more verbose)
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Minimum log level from environment (default: info)
const MIN_LOG_LEVEL = (process.env.LOG_LEVEL as LogLevel) ?? "info";

/**
 * Check if a log level should be emitted
 */
function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[MIN_LOG_LEVEL];
}

/**
 * Create a scoped logger for a specific component
 */
export function createLogger(component: string) {
  const log = (
    level: LogLevel,
    event: string,
    options: {
      correlationId?: string;
      durationMs?: number;
      data?: Record<string, unknown>;
    } = {},
  ) => {
    if (!shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component,
      event,
    };

    if (options.correlationId) {
      entry.correlation_id = options.correlationId;
    }
    if (options.durationMs !== undefined) {
      entry.duration_ms = options.durationMs;
    }
    if (options.data) {
      entry.data = options.data;
    }

    // Output as JSON to stderr (keeps stdout clean for primary output)
    // This follows Unix convention: logs to stderr, data to stdout
    console.error(JSON.stringify(entry));
  };

  return {
    debug: (event: string, options?: Parameters<typeof log>[2]) => log("debug", event, options),
    info: (event: string, options?: Parameters<typeof log>[2]) => log("info", event, options),
    warn: (event: string, options?: Parameters<typeof log>[2]) => log("warn", event, options),
    error: (event: string, options?: Parameters<typeof log>[2]) => log("error", event, options),

    /**
     * Time an async operation and log when complete
     */
    async timed<T>(
      event: string,
      fn: () => Promise<T>,
      options?: { correlationId?: string; data?: Record<string, unknown> },
    ): Promise<T> {
      const start = Date.now();
      try {
        const result = await fn();
        log("info", event, {
          correlationId: options?.correlationId,
          durationMs: Date.now() - start,
          data: options?.data,
        });
        return result;
      } catch (error) {
        log("error", `${event}_failed`, {
          correlationId: options?.correlationId,
          durationMs: Date.now() - start,
          data: {
            ...options?.data,
            error: error instanceof Error ? error.message : String(error),
          },
        });
        throw error;
      }
    },
  };
}
