/**
 * Circuit Breaker for service resilience
 *
 * State machine:
 * - CLOSED: Normal operation, track failures
 * - OPEN: Fast-fail all requests (after N consecutive failures)
 * - HALF_OPEN: Allow one test request after cooldown
 *
 * Per-endpoint tracking allows fine-grained protection.
 */

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerConfig {
  failureThreshold: number; // Failures before opening (default: 3)
  cooldownMs: number; // Time in open state before half-open (default: 30000)
}

interface CircuitStatus {
  state: CircuitState;
  failures: number;
  lastFailure: number;
  lastSuccess: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  cooldownMs: 30000,
};

/**
 * Circuit breaker for protecting against cascading failures
 */
export class CircuitBreaker {
  private circuits: Map<string, CircuitStatus> = new Map();
  private config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get or create circuit status for an endpoint
   */
  private getCircuit(endpoint: string): CircuitStatus {
    let status = this.circuits.get(endpoint);
    if (!status) {
      status = {
        state: "closed",
        failures: 0,
        lastFailure: 0,
        lastSuccess: 0,
      };
      this.circuits.set(endpoint, status);
    }
    return status;
  }

  /**
   * Check if endpoint should be available
   */
  isAvailable(endpoint: string): boolean {
    const status = this.getCircuit(endpoint);

    switch (status.state) {
      case "closed":
        return true;

      case "open": {
        // Check if cooldown has passed
        const elapsed = Date.now() - status.lastFailure;
        if (elapsed >= this.config.cooldownMs) {
          // Transition to half-open, allow one test request
          status.state = "half_open";
          return true;
        }
        return false;
      }

      case "half_open":
        // Allow one test request (first caller wins)
        return true;
    }
  }

  /**
   * Record a successful call
   */
  recordSuccess(endpoint: string): void {
    const status = this.getCircuit(endpoint);
    status.failures = 0;
    status.lastSuccess = Date.now();
    status.state = "closed";
  }

  /**
   * Record a failed call
   */
  recordFailure(endpoint: string): void {
    const status = this.getCircuit(endpoint);
    status.failures++;
    status.lastFailure = Date.now();

    if (status.state === "half_open") {
      // Test request failed, back to open
      status.state = "open";
    } else if (status.failures >= this.config.failureThreshold) {
      // Threshold reached, trip the circuit
      status.state = "open";
    }
  }

  /**
   * Get current state of a circuit
   */
  getState(endpoint: string): CircuitState {
    return this.getCircuit(endpoint).state;
  }

  /**
   * Get failure count for a circuit
   */
  getFailureCount(endpoint: string): number {
    return this.getCircuit(endpoint).failures;
  }

  /**
   * Reset a specific circuit
   */
  reset(endpoint: string): void {
    this.circuits.delete(endpoint);
  }

  /**
   * Reset all circuits
   */
  resetAll(): void {
    this.circuits.clear();
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(endpoint: string, fn: () => Promise<T>): Promise<T> {
    if (!this.isAvailable(endpoint)) {
      throw new Error(`Circuit open for ${endpoint}`);
    }

    try {
      const result = await fn();
      this.recordSuccess(endpoint);
      return result;
    } catch (error) {
      this.recordFailure(endpoint);
      throw error;
    }
  }
}

// Singleton instance for shared use
let globalCircuitBreaker: CircuitBreaker | null = null;

/**
 * Get the global circuit breaker instance
 */
export function getCircuitBreaker(): CircuitBreaker {
  if (!globalCircuitBreaker) {
    globalCircuitBreaker = new CircuitBreaker();
  }
  return globalCircuitBreaker;
}

/**
 * Create a new circuit breaker with custom config
 */
export function createCircuitBreaker(config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
  return new CircuitBreaker(config);
}
