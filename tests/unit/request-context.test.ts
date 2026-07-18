import { describe, it, expect } from "vitest";
import {
  runWithRequestContext,
  runWithTrace,
  getRequestContext,
  setContextUserId,
  contextLogFields,
} from "../../server/request-context";

describe("request-context (AsyncLocalStorage correlation)", () => {
  it("returns undefined outside any context", () => {
    expect(getRequestContext()).toBeUndefined();
    expect(contextLogFields()).toEqual({});
  });

  it("propagates requestId/correlationId through an async chain", async () => {
    await runWithRequestContext({ requestId: "req-1", correlationId: "corr-1" }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      expect(getRequestContext()).toEqual({ requestId: "req-1", correlationId: "corr-1" });
    });
  });

  it("does not leak context across sibling calls", async () => {
    await runWithRequestContext({ requestId: "req-a", correlationId: "corr-a" }, async () => {
      expect(getRequestContext()?.requestId).toBe("req-a");
    });
    expect(getRequestContext()).toBeUndefined();
  });

  it("setContextUserId mutates the active context in place", async () => {
    await runWithRequestContext({ requestId: "req-2", correlationId: "corr-2" }, async () => {
      setContextUserId(42);
      expect(getRequestContext()?.userId).toBe(42);
      await new Promise((resolve) => setTimeout(resolve, 1));
      // Still visible after an await — proves it's the live context, not a snapshot.
      expect(getRequestContext()?.userId).toBe(42);
    });
  });

  it("runWithTrace mints a fresh context when none exists", async () => {
    await runWithTrace("translation", "call_123", async () => {
      const ctx = getRequestContext();
      expect(ctx?.traceId).toBe("translation:call_123");
      expect(ctx?.requestId).toBeTruthy();
    });
  });

  it("runWithTrace nests inside an existing HTTP request context, preserving its ids", async () => {
    await runWithRequestContext({ requestId: "req-3", correlationId: "corr-3", userId: 7 }, async () => {
      await runWithTrace("payments", "refund:99", async () => {
        const ctx = getRequestContext();
        expect(ctx?.requestId).toBe("req-3");
        expect(ctx?.correlationId).toBe("corr-3");
        expect(ctx?.userId).toBe(7);
        expect(ctx?.traceId).toBe("payments:refund:99");
      });
      // Back outside the trace, the outer context is unaffected by the nested traceId.
      expect(getRequestContext()?.traceId).toBeUndefined();
    });
  });

  it("contextLogFields omits userId/traceId when unset and includes them when set", async () => {
    await runWithRequestContext({ requestId: "req-4", correlationId: "corr-4" }, async () => {
      expect(contextLogFields()).toEqual({ requestId: "req-4", correlationId: "corr-4" });
      setContextUserId(5);
      expect(contextLogFields()).toEqual({ requestId: "req-4", correlationId: "corr-4", userId: 5 });
    });
  });
});
