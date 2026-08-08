import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression test for the IDOR fix in server/modules/webhooks/service.ts:
 * deleteWebhookEndpoint and setWebhookEndpointActive must scope their
 * DB delete/update by BOTH the webhook's own id AND the caller's
 * organizationId — never just the id alone (which would let any org admin
 * delete/toggle another org's webhook by guessing/incrementing an id).
 *
 * This test asserts against the actual WHERE-clause predicate constructed
 * by the real service functions (by capturing drizzle-orm's eq()/and()
 * calls), not just against a mocked DB's return value — so it fails if
 * someone removes the organizationId condition even if a mock happens to
 * still return a "success" shape.
 */

const eqCalls: Array<{ column: unknown; value: unknown }> = [];
const andCalls: unknown[][] = [];

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (column: unknown, value: unknown) => {
      const cond = { __eq: true, column, value };
      eqCalls.push({ column, value });
      return cond;
    },
    and: (...conds: unknown[]) => {
      andCalls.push(conds);
      return { __and: true, conds };
    },
  };
});

let deleteWhereArg: unknown;
let updateWhereArg: unknown;

vi.mock("../../server/db", () => ({
  db: {
    delete: () => ({
      where: (cond: unknown) => {
        deleteWhereArg = cond;
        return { returning: () => Promise.resolve([{ id: 1 }]) };
      },
    }),
    update: () => ({
      set: () => ({
        where: (cond: unknown) => {
          updateWhereArg = cond;
          return { returning: () => Promise.resolve([{ id: 1 }]) };
        },
      }),
    }),
  },
}));

vi.mock("@shared/schema", () => ({
  webhookEndpoints: {
    id: "webhookEndpoints.id",
    organizationId: "webhookEndpoints.organizationId",
    isActive: "webhookEndpoints.isActive",
    updatedAt: "webhookEndpoints.updatedAt",
  },
  webhookDeliveries: {},
  WEBHOOK_DELIVERY_STATUS: { PENDING: "pending", DELIVERED: "delivered", FAILED: "failed", EXHAUSTED: "exhausted" },
  WEBHOOK_EVENT_TYPES: ["call.initiated", "call.ended"],
}));

vi.mock("../../server/observability", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe("webhook endpoint IDOR guard", () => {
  beforeEach(() => {
    eqCalls.length = 0;
    andCalls.length = 0;
    deleteWhereArg = undefined;
    updateWhereArg = undefined;
  });

  it("deleteWebhookEndpoint scopes its DELETE by BOTH id and organizationId, not id alone", async () => {
    const { deleteWebhookEndpoint } = await import("../../server/modules/webhooks/service");
    await deleteWebhookEndpoint(42, 7);

    // and() must have been called (a single eq() alone would mean no
    // org-scoping at all — the exact IDOR this test guards against).
    expect(andCalls.length).toBeGreaterThan(0);
    const idCondition = eqCalls.find((c) => c.column === "webhookEndpoints.id" && c.value === 7);
    const orgCondition = eqCalls.find((c) => c.column === "webhookEndpoints.organizationId" && c.value === 42);
    expect(idCondition).toBeTruthy();
    expect(orgCondition).toBeTruthy();
    expect(deleteWhereArg).toBeTruthy();
  });

  it("setWebhookEndpointActive scopes its UPDATE by BOTH id and organizationId, not id alone", async () => {
    const { setWebhookEndpointActive } = await import("../../server/modules/webhooks/service");
    await setWebhookEndpointActive(99, 3, false);

    expect(andCalls.length).toBeGreaterThan(0);
    const idCondition = eqCalls.find((c) => c.column === "webhookEndpoints.id" && c.value === 3);
    const orgCondition = eqCalls.find((c) => c.column === "webhookEndpoints.organizationId" && c.value === 99);
    expect(idCondition).toBeTruthy();
    expect(orgCondition).toBeTruthy();
    expect(updateWhereArg).toBeTruthy();
  });
});
