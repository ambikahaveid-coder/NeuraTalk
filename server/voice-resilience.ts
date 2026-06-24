import { randomUUID } from "node:crypto";
import { logger } from "./observability";

type ProviderState = "healthy" | "degraded" | "open";

interface ProviderHealthEntry {
  provider: string;
  state: ProviderState;
  score: number;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  circuitOpenedAt: number | null;
  lastError: string | null;
  lastLatencyMs: number | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
}

interface RunWithResilienceOptions {
  provider: string;
  operation: string;
  timeoutMs: number;
  retries?: number;
  retryDelayMs?: number;
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
}

interface LinkedAbortController {
  controller: AbortController;
  cleanup: () => void;
}

const providerHealth = new Map<string, ProviderHealthEntry>();
const DEFAULT_RETRY_DELAY_MS = 150;
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 30_000;

function abortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function getOrCreateEntry(provider: string): ProviderHealthEntry {
  const existing = providerHealth.get(provider);
  if (existing) {
    return existing;
  }

  const created: ProviderHealthEntry = {
    provider,
    state: "healthy",
    score: 100,
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    circuitOpenedAt: null,
    lastError: null,
    lastLatencyMs: null,
    lastSuccessAt: null,
    lastFailureAt: null,
  };
  providerHealth.set(provider, created);
  return created;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.message.includes("aborted"));
}

function shouldAllowAttempt(entry: ProviderHealthEntry): boolean {
  if (entry.state !== "open") {
    return true;
  }

  if (!entry.circuitOpenedAt) {
    return true;
  }

  if (Date.now() - entry.circuitOpenedAt >= CIRCUIT_BREAKER_COOLDOWN_MS) {
    entry.state = "degraded";
    entry.circuitOpenedAt = null;
    return true;
  }

  return false;
}

function markSuccess(provider: string, latencyMs: number): void {
  const entry = getOrCreateEntry(provider);
  entry.consecutiveFailures = 0;
  entry.consecutiveSuccesses += 1;
  entry.lastError = null;
  entry.lastLatencyMs = Math.round(latencyMs);
  entry.lastSuccessAt = Date.now();
  entry.circuitOpenedAt = null;
  entry.state = entry.consecutiveSuccesses >= 2 ? "healthy" : "degraded";
  entry.score = Math.max(0, Math.min(100, entry.score + 8));
}

function markFailure(provider: string, error: unknown): void {
  const entry = getOrCreateEntry(provider);
  entry.consecutiveFailures += 1;
  entry.consecutiveSuccesses = 0;
  entry.lastFailureAt = Date.now();
  entry.lastError = error instanceof Error ? error.message : String(error);
  entry.score = Math.max(0, entry.score - 18);
  if (entry.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    entry.state = "open";
    entry.circuitOpenedAt = Date.now();
    return;
  }
  entry.state = "degraded";
}

export function createLinkedAbortController(input: {
  signal?: AbortSignal;
  timeoutMs?: number;
  label: string;
}): LinkedAbortController {
  const controller = new AbortController();
  const cleanups: Array<() => void> = [];

  if (input.signal) {
    if (input.signal.aborted) {
      controller.abort(input.signal.reason ?? abortError(`${input.label} aborted by parent signal`));
    } else {
      const onAbort = () => {
        controller.abort(input.signal?.reason ?? abortError(`${input.label} aborted by parent signal`));
      };
      input.signal.addEventListener("abort", onAbort, { once: true });
      cleanups.push(() => input.signal?.removeEventListener("abort", onAbort));
    }
  }

  if (input.timeoutMs && input.timeoutMs > 0) {
    const timeout = setTimeout(() => {
      controller.abort(abortError(`${input.label} timed out after ${input.timeoutMs}ms`));
    }, input.timeoutMs);
    cleanups.push(() => clearTimeout(timeout));
  }

  return {
    controller,
    cleanup: () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    },
  };
}

export async function runWithResilience<T>(
  work: (signal: AbortSignal, attempt: number) => Promise<T>,
  options: RunWithResilienceOptions,
): Promise<T> {
  const retries = Math.max(0, options.retries ?? 0);
  const retryDelayMs = Math.max(25, options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
  const entry = getOrCreateEntry(options.provider);

  if (!shouldAllowAttempt(entry)) {
    throw new Error(`Circuit open for ${options.provider}`);
  }

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const traceId = randomUUID();
    const startedAt = Date.now();
    const linked = createLinkedAbortController({
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      label: `${options.provider}.${options.operation}`,
    });

    try {
      const result = await work(linked.controller.signal, attempt);
      markSuccess(options.provider, Date.now() - startedAt);
      if (attempt > 0) {
        logger.warn("VoiceResilience", "Provider recovered after retry", {
          provider: options.provider,
          operation: options.operation,
          attempt,
          traceId,
          ...options.metadata,
        });
      }
      return result;
    } catch (error) {
      lastError = error;
      markFailure(options.provider, error);
      logger.warn("VoiceResilience", "Provider operation failed", {
        provider: options.provider,
        operation: options.operation,
        attempt,
        traceId,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
        ...options.metadata,
      });

      if (attempt >= retries || isAbortError(error)) {
        throw error;
      }

      await wait(retryDelayMs * (attempt + 1));
    } finally {
      linked.cleanup();
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function getProviderHealthSnapshot(): ProviderHealthEntry[] {
  return Array.from(providerHealth.values()).map((entry) => ({ ...entry }));
}
