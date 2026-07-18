import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { runWithRequestContext } from "./request-context";

/**
 * Generates (or propagates) a request ID and correlation ID for every
 * incoming HTTP request, and runs the rest of the request's handling inside
 * an AsyncLocalStorage context carrying them — every logger call anywhere
 * downstream (including async/fire-and-forget work kicked off by this
 * request) automatically picks them up. See server/request-context.ts.
 */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = randomUUID();
  // Honor an inbound X-Correlation-Id (e.g. from a load balancer, another
  // service, or a client that wants to tie its own logs to this request)
  // rather than always minting a fresh one.
  const inboundCorrelationId = req.headers["x-correlation-id"];
  const correlationId = typeof inboundCorrelationId === "string" && inboundCorrelationId.trim()
    ? inboundCorrelationId.trim()
    : requestId;

  res.setHeader("X-Request-Id", requestId);
  res.setHeader("X-Correlation-Id", correlationId);

  runWithRequestContext({ requestId, correlationId }, () => next());
}
