import { describe, it, expect, beforeEach } from "vitest";
import { EventEmitter } from "events";
import { httpMetricsMiddleware, getHttpMetricsSnapshot, resetHttpMetrics } from "../../server/http-metrics-middleware";

function fakeReqRes(method: string, path: string, statusCode: number) {
  const req: any = { method, path, route: { path } };
  const res: any = new EventEmitter();
  res.statusCode = statusCode;
  return { req, res };
}

describe("http-metrics-middleware", () => {
  beforeEach(() => {
    resetHttpMetrics();
  });

  it("records a latency sample and request count when the response finishes", async () => {
    const { req, res } = fakeReqRes("GET", "/api/health", 200);
    httpMetricsMiddleware(req, res, () => {});
    res.emit("finish");

    const snapshot = getHttpMetricsSnapshot();
    expect(snapshot.overall.count).toBe(1);
    expect(snapshot.requestCounts).toContainEqual(expect.objectContaining({ route: "GET /api/health", status: 200, count: 1 }));
  });

  it("computes a 0 error rate when all responses are 2xx", async () => {
    for (let i = 0; i < 5; i++) {
      const { req, res } = fakeReqRes("GET", "/api/payments/status", 200);
      httpMetricsMiddleware(req, res, () => {});
      res.emit("finish");
    }
    expect(getHttpMetricsSnapshot().errorRate).toBe(0);
  });

  it("computes a nonzero error rate when some responses are 5xx", async () => {
    for (let i = 0; i < 4; i++) {
      const { req, res } = fakeReqRes("POST", "/api/payments/create-order", 200);
      httpMetricsMiddleware(req, res, () => {});
      res.emit("finish");
    }
    const { req, res } = fakeReqRes("POST", "/api/payments/create-order", 500);
    httpMetricsMiddleware(req, res, () => {});
    res.emit("finish");

    expect(getHttpMetricsSnapshot().errorRate).toBe(0.2);
  });

  it("tracks per-route latency separately from the overall aggregate", async () => {
    const { req: req1, res: res1 } = fakeReqRes("GET", "/api/a", 200);
    httpMetricsMiddleware(req1, res1, () => {});
    res1.emit("finish");

    const { req: req2, res: res2 } = fakeReqRes("GET", "/api/b", 200);
    httpMetricsMiddleware(req2, res2, () => {});
    res2.emit("finish");

    const snapshot = getHttpMetricsSnapshot();
    const routes = snapshot.byRoute.map((r) => r.route);
    expect(routes).toContain("GET /api/a");
    expect(routes).toContain("GET /api/b");
  });

  it("calls next() synchronously so the request pipeline isn't blocked", () => {
    const { req, res } = fakeReqRes("GET", "/x", 200);
    let called = false;
    httpMetricsMiddleware(req, res, () => { called = true; });
    expect(called).toBe(true);
  });
});
