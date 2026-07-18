import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "crypto";

/**
 * Lightweight, self-hosted request/trace correlation — no external
 * collector (Jaeger/Tempo/OpenTelemetry backend) is configured in this
 * environment, so this is NOT full distributed tracing with a span-tree
 * visualization UI. It IS a real correlation mechanism: every log line
 * emitted anywhere during a request's async execution (including
 * fire-and-forget background work started from it) carries the same
 * requestId/correlationId/userId/traceId without every call site having to
 * pass them manually, via Node's built-in AsyncLocalStorage.
 */
export interface RequestContext {
  requestId: string;
  correlationId: string;
  userId?: number;
  /** Subsystem-scoped operation id, e.g. "translation:call_abc123" or "payments:refund:42". */
  traceId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Attaches a userId to the current request context once auth resolves it. Mutates in place — AsyncLocalStorage stores are shared by reference across the whole async chain. */
export function setContextUserId(userId: number): void {
  const ctx = storage.getStore();
  if (ctx) ctx.userId = userId;
}

/**
 * Runs `fn` inside a request context scoped to a background/non-HTTP
 * operation (a call pipeline step, a voice-clone training job, a payment
 * webhook, a scheduled job) — for work that doesn't originate from an
 * incoming HTTP request but still needs its logs correlated together.
 */
export function runWithTrace<T>(subsystem: string, operationId: string, fn: () => T): T {
  const existing = storage.getStore();
  const traceId = `${subsystem}:${operationId}`;
  if (existing) {
    // Nest inside an existing (e.g. HTTP request) context — keep its
    // requestId/correlationId/userId, just tag this operation's traceId.
    return storage.run({ ...existing, traceId }, fn);
  }
  const requestId = randomUUID();
  return storage.run({ requestId, correlationId: requestId, traceId }, fn);
}

/** Returns fields suitable for spreading into a logger metadata object — omits undefined keys. */
export function contextLogFields(): Record<string, string | number> {
  const ctx = storage.getStore();
  if (!ctx) return {};
  const fields: Record<string, string | number> = {
    requestId: ctx.requestId,
    correlationId: ctx.correlationId,
  };
  if (ctx.userId != null) fields.userId = ctx.userId;
  if (ctx.traceId) fields.traceId = ctx.traceId;
  return fields;
}
