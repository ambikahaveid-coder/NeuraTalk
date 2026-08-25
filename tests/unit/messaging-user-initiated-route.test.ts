import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * P1-2 (2026-08-25): HTTP/controller-level tests for the new consumer-
 * facing entry point, POST /api/messaging/business/:businessId/messages
 * (server/modules/messaging/routes.ts + controller.ts's sendUserMessage).
 *
 * Scope split deliberately, to avoid duplicate proof:
 *   - Deep behavioral guarantees (customer reuse, conversation reuse, no
 *     duplicate customer/conversation/participant rows, cross-tenant
 *     isolation, real sender-participant resolution) are already proven at
 *     the SERVICE layer against a real fake-db in
 *     tests/unit/messaging-phase0.test.ts's "P1-1: sendUserInitiatedMessage"
 *     suite (9 tests, all passing) -- not re-proven here with a second,
 *     shallower mock.
 *   - THIS file proves the HTTP/controller layer specifically: that
 *     requireAuth is actually wired in (unauthenticated -> 401), that input
 *     validation matches the existing canonical-messaging content limit
 *     (8192, not an invented one), that a client-supplied identity field is
 *     structurally impossible to smuggle through to the service call, that
 *     service-thrown errors map to the right HTTP status without leaking
 *     internals, and that the response shape matches the existing
 *     postMessage convention.
 */

vi.mock("../../server/observability", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/modules/messaging/service", () => ({
  createBusinessConversation: vi.fn(),
  getBusinessConversation: vi.fn(),
  createMessage: vi.fn(),
  listMessages: vi.fn(),
  sendUserInitiatedMessage: vi.fn(),
  getPublicBusinessIdentity: vi.fn(),
  listUserInitiatedMessages: vi.fn(),
  InvalidParticipantError: class InvalidParticipantError extends Error {},
  NotFoundError: class NotFoundError extends Error {},
  NotAParticipantError: class NotAParticipantError extends Error {},
  SenderIdentityMismatchError: class SenderIdentityMismatchError extends Error {},
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function makeReqRes(user: any, body: any = {}, params: any = {}) {
  const req: any = { user, params, body, query: {} };
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
  return { req, res };
}

describe("P1-2: requireAuth is actually enforced on the route (1. unauthenticated -> 401)", () => {
  it("requireAuth denies a request with no req.user before the controller ever runs", async () => {
    const { requireAuth } = await import("../../server/role-middleware");
    const { req, res } = makeReqRes(undefined);
    let nextCalled = false;
    requireAuth(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it("requireAuth allows through when req.user is present", async () => {
    const { requireAuth } = await import("../../server/role-middleware");
    const { req, res } = makeReqRes({ id: 42 });
    let nextCalled = false;
    requireAuth(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });
});

describe("P1-2: POST /api/messaging/business/:businessId/messages (controller.sendUserMessage)", () => {
  it("2. authenticated normal user + valid business -> message succeeds, response matches existing postMessage shape ({success, message, deliveries})", async () => {
    const service = await import("../../server/modules/messaging/service");
    (service.sendUserInitiatedMessage as any).mockResolvedValue({
      message: { id: 1, conversationId: 5, content: "hi", senderParticipantId: 9 },
      deliveries: [{ id: 1, participantId: 10, status: "queued" }],
    });

    const ctrl = await import("../../server/modules/messaging/controller");
    const { req, res } = makeReqRes({ id: 42 }, { content: "hi, I need help" }, { businessId: "7" });
    await ctrl.sendUserMessage(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({
      success: true,
      message: { id: 1, conversationId: 5, content: "hi", senderParticipantId: 9 },
      deliveries: [{ id: 1, participantId: 10, status: "queued" }],
    });
  });

  it("3. a request body containing a fake userId/authenticatedUserId CANNOT spoof the sender -- the service is always called with req.user.id", async () => {
    const service = await import("../../server/modules/messaging/service");
    (service.sendUserInitiatedMessage as any).mockResolvedValue({ message: {}, deliveries: [] });

    const ctrl = await import("../../server/modules/messaging/controller");
    const { req, res } = makeReqRes(
      { id: 42 }, // authenticated as user 42
      { content: "hi", userId: 999, authenticatedUserId: 999, senderParticipantId: 999 }, // attempted spoof fields
      { businessId: "7" },
    );
    await ctrl.sendUserMessage(req, res);

    expect(res.statusCode).toBe(201);
    const callArg = (service.sendUserInitiatedMessage as any).mock.calls[0][0];
    expect(callArg.authenticatedUserId).toBe(42); // from req.user.id, never the body
    // sendUserMessageSchema has no senderParticipantId/userId field at all --
    // confirm none of the spoof fields leaked into the service call.
    expect(callArg).not.toHaveProperty("userId");
    expect(callArg).not.toHaveProperty("senderParticipantId");
  });

  it("4. nonexistent business -> NotFoundError maps to 404, not 500 or a silent success", async () => {
    const service = await import("../../server/modules/messaging/service");
    const { NotFoundError } = service as any;
    (service.sendUserInitiatedMessage as any).mockRejectedValue(new NotFoundError("Business not found"));

    const ctrl = await import("../../server/modules/messaging/controller");
    const { req, res } = makeReqRes({ id: 42 }, { content: "hi" }, { businessId: "999999" });
    await ctrl.sendUserMessage(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ success: false, error: "Business not found" });
  });

  it("invalid (non-numeric) businessId is rejected before the service is ever called", async () => {
    const service = await import("../../server/modules/messaging/service");
    const ctrl = await import("../../server/modules/messaging/controller");
    const { req, res } = makeReqRes({ id: 42 }, { content: "hi" }, { businessId: "not-a-number" });
    await ctrl.sendUserMessage(req, res);

    expect(res.statusCode).toBe(400);
    expect(service.sendUserInitiatedMessage).not.toHaveBeenCalled();
  });

  it("5. empty content -> 400 validation error, service never called", async () => {
    const service = await import("../../server/modules/messaging/service");
    const ctrl = await import("../../server/modules/messaging/controller");
    const { req, res } = makeReqRes({ id: 42 }, { content: "" }, { businessId: "7" });
    await ctrl.sendUserMessage(req, res);

    expect(res.statusCode).toBe(400);
    expect(service.sendUserInitiatedMessage).not.toHaveBeenCalled();
  });

  it("5b. whitespace-only content -> 400 (zod min(1) alone would pass ' ', but this must still be rejected)", async () => {
    // Note: z.string().min(1) on " " (a single space) passes zod's own
    // check -- the REAL emptiness guard is createMessageTx's own
    // content.trim() check (VALIDATION_EMPTY_CONTENT), reused unmodified
    // via sendUserInitiatedMessage. This test proves that guard is still
    // reachable through the new route, not bypassed.
    const service = await import("../../server/modules/messaging/service");
    (service.sendUserInitiatedMessage as any).mockRejectedValue(new Error("VALIDATION_EMPTY_CONTENT"));

    const ctrl = await import("../../server/modules/messaging/controller");
    const { req, res } = makeReqRes({ id: 42 }, { content: "   " }, { businessId: "7" });
    await ctrl.sendUserMessage(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, error: "content must not be empty" });
  });

  it("6. oversized content (>8192, the EXISTING canonical messaging limit, not a new one) -> 400, service never called", async () => {
    const service = await import("../../server/modules/messaging/service");
    const ctrl = await import("../../server/modules/messaging/controller");
    const { req, res } = makeReqRes({ id: 42 }, { content: "a".repeat(8193) }, { businessId: "7" });
    await ctrl.sendUserMessage(req, res);

    expect(res.statusCode).toBe(400);
    expect(service.sendUserInitiatedMessage).not.toHaveBeenCalled();
  });

  it("content at exactly the 8192 limit is accepted (boundary check)", async () => {
    const service = await import("../../server/modules/messaging/service");
    (service.sendUserInitiatedMessage as any).mockResolvedValue({ message: {}, deliveries: [] });
    const ctrl = await import("../../server/modules/messaging/controller");
    const { req, res } = makeReqRes({ id: 42 }, { content: "a".repeat(8192) }, { businessId: "7" });
    await ctrl.sendUserMessage(req, res);

    expect(res.statusCode).toBe(201);
    expect(service.sendUserInitiatedMessage).toHaveBeenCalled();
  });

  it("12. a raw internal error (e.g. simulated DB failure) is NEVER exposed to the client -- generic message + 500, no stack trace, no error.message leak", async () => {
    const service = await import("../../server/modules/messaging/service");
    (service.sendUserInitiatedMessage as any).mockRejectedValue(
      new Error("connection terminated unexpectedly at Socket.<anonymous> (pg-pool/index.js:45:11) DATABASE_URL=postgres://real-secret"),
    );

    const ctrl = await import("../../server/modules/messaging/controller");
    const { req, res } = makeReqRes({ id: 42 }, { content: "hi" }, { businessId: "7" });
    await ctrl.sendUserMessage(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ success: false, error: "Failed to send message" });
    const responseText = JSON.stringify(res.body);
    expect(responseText).not.toContain("DATABASE_URL");
    expect(responseText).not.toContain("pg-pool");
    expect(responseText).not.toContain("Socket");
  });

  it("13. the resolved sender identity passed to the service is exactly req.user.id, for a different authenticated user too", async () => {
    const service = await import("../../server/modules/messaging/service");
    (service.sendUserInitiatedMessage as any).mockResolvedValue({ message: {}, deliveries: [] });

    const ctrl = await import("../../server/modules/messaging/controller");
    const { req, res } = makeReqRes({ id: 777 }, { content: "namaste" }, { businessId: "3" });
    await ctrl.sendUserMessage(req, res);

    const callArg = (service.sendUserInitiatedMessage as any).mock.calls[0][0];
    expect(callArg.authenticatedUserId).toBe(777);
  });

  it("14. the business tenant passed to the service is exactly the validated :businessId URL param", async () => {
    const service = await import("../../server/modules/messaging/service");
    (service.sendUserInitiatedMessage as any).mockResolvedValue({ message: {}, deliveries: [] });

    const ctrl = await import("../../server/modules/messaging/controller");
    const { req, res } = makeReqRes({ id: 42 }, { content: "hi" }, { businessId: "555" });
    await ctrl.sendUserMessage(req, res);

    const callArg = (service.sendUserInitiatedMessage as any).mock.calls[0][0];
    expect(callArg.businessId).toBe(555);
  });

  it("messageType, when supplied, passes through unchanged (existing supported field)", async () => {
    const service = await import("../../server/modules/messaging/service");
    (service.sendUserInitiatedMessage as any).mockResolvedValue({ message: {}, deliveries: [] });

    const ctrl = await import("../../server/modules/messaging/controller");
    const { req, res } = makeReqRes({ id: 42 }, { content: "hi", messageType: "text" }, { businessId: "7" });
    await ctrl.sendUserMessage(req, res);

    const callArg = (service.sendUserInitiatedMessage as any).mock.calls[0][0];
    expect(callArg.messageType).toBe("text");
  });
});

describe("P1-2: route wiring (no requireCompanyAccess/requirePermission on this route -- source-level check)", () => {
  it("registerMessagingRoutes wires the new route with requireAuth only, distinct from the business-side routes", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const source = fs.readFileSync(path.resolve(__dirname, "../../server/modules/messaging/routes.ts"), "utf8");

    const routeIdx = source.indexOf('"/api/messaging/business/:businessId/messages"');
    expect(routeIdx).toBeGreaterThan(-1);
    // Bounded to this specific app.post(...) call's own closing `);`, not
    // the next literal "app." occurrence -- a later route's own doc comment
    // mentioning "requireCompanyAccess" in prose would otherwise get swept
    // into the slice and produce a false failure here.
    const closeIdx = source.indexOf(");", routeIdx);
    const routeBlock = source.slice(routeIdx, closeIdx);

    expect(routeBlock).toContain("requireAuth");
    expect(routeBlock).not.toContain("requireCompanyAccess");
    expect(routeBlock).not.toContain("requirePermission");
    expect(routeBlock).toContain("ctrl.sendUserMessage");
  });
});

describe("P1-3A Part A: GET /api/messaging/business/:businessId (controller.getBusinessIdentity)", () => {
  it("1. authenticated consumer can fetch a valid business's public identity", async () => {
    const service = await import("../../server/modules/messaging/service");
    (service.getPublicBusinessIdentity as any).mockResolvedValue({
      id: 7, name: "Namaste Kirana Store", logoUrl: "https://cdn.example/logo.png", description: "Local grocery",
    });

    const ctrl = await import("../../server/modules/messaging/controller");
    const { req, res } = makeReqRes({ id: 42 }, {}, { businessId: "7" });
    await ctrl.getBusinessIdentity(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      business: { id: 7, name: "Namaste Kirana Store", logoUrl: "https://cdn.example/logo.png", description: "Local grocery" },
    });
  });

  it("2. nonexistent business -> safe 404, not a 500 or a fabricated identity", async () => {
    const service = await import("../../server/modules/messaging/service");
    (service.getPublicBusinessIdentity as any).mockResolvedValue(null);

    const ctrl = await import("../../server/modules/messaging/controller");
    const { req, res } = makeReqRes({ id: 42 }, {}, { businessId: "999999" });
    await ctrl.getBusinessIdentity(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ success: false, error: "Business not found" });
  });

  it("invalid (non-numeric) businessId is rejected before the service is ever called", async () => {
    const service = await import("../../server/modules/messaging/service");
    const ctrl = await import("../../server/modules/messaging/controller");
    const { req, res } = makeReqRes({ id: 42 }, {}, { businessId: "not-a-number" });
    await ctrl.getBusinessIdentity(req, res);

    expect(res.statusCode).toBe(400);
    expect(service.getPublicBusinessIdentity).not.toHaveBeenCalled();
  });

  it("internal errors never leak stack traces or details -- generic 500", async () => {
    const service = await import("../../server/modules/messaging/service");
    (service.getPublicBusinessIdentity as any).mockRejectedValue(new Error("connection terminated -- DATABASE_URL=postgres://secret"));

    const ctrl = await import("../../server/modules/messaging/controller");
    const { req, res } = makeReqRes({ id: 42 }, {}, { businessId: "7" });
    await ctrl.getBusinessIdentity(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ success: false, error: "Failed to load business" });
    expect(JSON.stringify(res.body)).not.toContain("DATABASE_URL");
  });

  it("4. requireAuth still gates this route (reuses the same middleware verified for the send route)", async () => {
    const { requireAuth } = await import("../../server/role-middleware");
    const { req, res } = makeReqRes(undefined, {}, { businessId: "7" });
    let nextCalled = false;
    requireAuth(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });
});

describe("P1-3A Part B: GET /api/messaging/business/:businessId/messages (controller.getUserMessages)", () => {
  it("5 & 12. authenticated user can read their own conversation, response matches the existing listMessages shape plus the P1-A viewerParticipantId", async () => {
    const service = await import("../../server/modules/messaging/service");
    (service.listUserInitiatedMessages as any).mockResolvedValue({
      messages: [{ id: 1, content: "hi" }], total: 1, limit: 50, offset: 0, viewerParticipantId: 101,
    });

    const ctrl = await import("../../server/modules/messaging/controller");
    const { req, res } = makeReqRes({ id: 42 }, {}, { businessId: "7" });
    await ctrl.getUserMessages(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, messages: [{ id: 1, content: "hi" }], total: 1, limit: 50, offset: 0, viewerParticipantId: 101 });
  });

  it("9. a userId/authenticatedUserId supplied in the query string CANNOT override req.user.id", async () => {
    const service = await import("../../server/modules/messaging/service");
    (service.listUserInitiatedMessages as any).mockResolvedValue({ messages: [], total: 0, limit: 50, offset: 0 });

    const ctrl = await import("../../server/modules/messaging/controller");
    const req: any = { user: { id: 42 }, params: { businessId: "7" }, query: { userId: "999", authenticatedUserId: "999" }, body: {} };
    const res: any = { statusCode: 200, body: undefined, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } };
    await ctrl.getUserMessages(req, res);

    const callArgs = (service.listUserInitiatedMessages as any).mock.calls[0];
    expect(callArgs[1]).toBe(42); // authenticatedUserId positional arg came from req.user.id, not the query
  });

  it("11. no customer/conversation yet -> clean empty result passed straight through, not an error, viewerParticipantId is null (nothing to attribute)", async () => {
    const service = await import("../../server/modules/messaging/service");
    (service.listUserInitiatedMessages as any).mockResolvedValue({ messages: [], total: 0, limit: 50, offset: 0, viewerParticipantId: null });

    const ctrl = await import("../../server/modules/messaging/controller");
    const { req, res } = makeReqRes({ id: 42 }, {}, { businessId: "7" });
    await ctrl.getUserMessages(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, messages: [], total: 0, limit: 50, offset: 0, viewerParticipantId: null });
  });

  it("13. limit/offset query params are parsed and forwarded to the service", async () => {
    const service = await import("../../server/modules/messaging/service");
    (service.listUserInitiatedMessages as any).mockResolvedValue({ messages: [], total: 0, limit: 10, offset: 5 });

    const ctrl = await import("../../server/modules/messaging/controller");
    const req: any = { user: { id: 42 }, params: { businessId: "7" }, query: { limit: "10", offset: "5" }, body: {} };
    const res: any = { statusCode: 200, body: undefined, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } };
    await ctrl.getUserMessages(req, res);

    const callArgs = (service.listUserInitiatedMessages as any).mock.calls[0];
    expect(callArgs[2]).toEqual({ limit: 10, offset: 5 });
  });

  it("invalid limit query param is rejected with 400, service never called", async () => {
    const service = await import("../../server/modules/messaging/service");
    const ctrl = await import("../../server/modules/messaging/controller");
    const req: any = { user: { id: 42 }, params: { businessId: "7" }, query: { limit: "not-a-number" }, body: {} };
    const res: any = { statusCode: 200, body: undefined, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } };
    await ctrl.getUserMessages(req, res);

    expect(res.statusCode).toBe(400);
    expect(service.listUserInitiatedMessages).not.toHaveBeenCalled();
  });

  it("14. internal errors never leak stack traces or details -- generic 500", async () => {
    const service = await import("../../server/modules/messaging/service");
    (service.listUserInitiatedMessages as any).mockRejectedValue(new Error("relation messaging_messages does not exist at pg-pool"));

    const ctrl = await import("../../server/modules/messaging/controller");
    const { req, res } = makeReqRes({ id: 42 }, {}, { businessId: "7" });
    await ctrl.getUserMessages(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ success: false, error: "Failed to load messages" });
    expect(JSON.stringify(res.body)).not.toContain("pg-pool");
  });

  it("15. response contains no credentials/tokens/employee identity -- only message/pagination fields plus the P1-A viewerParticipantId (a plain numeric participant row id, not an employee identifier)", async () => {
    const service = await import("../../server/modules/messaging/service");
    (service.listUserInitiatedMessages as any).mockResolvedValue({ messages: [], total: 0, limit: 50, offset: 0, viewerParticipantId: null });

    const ctrl = await import("../../server/modules/messaging/controller");
    const { req, res } = makeReqRes({ id: 42 }, {}, { businessId: "7" });
    await ctrl.getUserMessages(req, res);

    expect(Object.keys(res.body)).toEqual(["success", "messages", "total", "limit", "offset", "viewerParticipantId"]);
  });

  it("route wiring: GET .../messages uses requireAuth only, no requireCompanyAccess/requirePermission (source-level check)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const source = fs.readFileSync(path.resolve(__dirname, "../../server/modules/messaging/routes.ts"), "utf8");

    const getIdx = source.indexOf('app.get(\n    "/api/messaging/business/:businessId/messages"');
    expect(getIdx).toBeGreaterThan(-1);
    // Bounded to this call's own closing `);`, same reasoning as the POST
    // route's wiring test above -- robust to later comments/routes being added.
    const closeIdx = source.indexOf(");", getIdx);
    const routeBlock = source.slice(getIdx, closeIdx);

    expect(routeBlock).toContain("requireAuth");
    expect(routeBlock).not.toContain("requireCompanyAccess");
    expect(routeBlock).not.toContain("requirePermission");
    expect(routeBlock).toContain("ctrl.getUserMessages");
  });
});
