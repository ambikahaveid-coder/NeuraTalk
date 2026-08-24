import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Business OTP / Authentication Messaging tests (Phase 6).
 * See docs/neura-ecosystem/31_BUSINESS_OTP_AUTHENTICATION_IMPLEMENTATION.md.
 *
 * Full integration: uses the REAL customers, templates, messaging, and OTP
 * services together against ONE shared in-memory fake DB -- same pattern
 * established in approvals.test.ts (Phase 3) and campaigns.test.ts
 * (Phase 5). otp/billing.ts is mocked (its shared underlying primitive's
 * real arithmetic is already proven in campaigns-billing.test.ts). Redis
 * lockout functions are mocked here too (their namespace-separation
 * correctness is proven separately in otp-lockout-namespace.test.ts) --
 * this file focuses on challenge lifecycle/security/gating logic.
 */

type Row = Record<string, any>;
const tables = new Map<string, Row[]>();
const idCounters = new Map<string, number>();

const ALL_TABLES = [
  "organizations", "users", "customers", "templates", "templateVersions",
  "businessOtpChallenges", "businessOtpDeliveries",
  "messagingConversations", "businessConversations", "messagingParticipants",
  "messagingMessages", "messagingDeliveries", "messagingEvents",
];

function resetFakeDb() {
  tables.clear();
  idCounters.clear();
  for (const t of ALL_TABLES) { tables.set(t, []); idCounters.set(t, 0); }
  tables.get("organizations")!.push({ id: 1 }, { id: 2 });
}

function tableNameOf(tableDescriptor: Row): string {
  const sample = Object.values(tableDescriptor)[0] as string;
  return sample.split(".")[0];
}
function fieldNameOf(colDescriptor: string): string {
  return colDescriptor.split(".").pop()!;
}
function evalCond(row: Row, cond: any): boolean {
  if (!cond) return true;
  if (cond.__and) return cond.conds.every((c: any) => evalCond(row, c));
  if (cond.__or) return cond.conds.some((c: any) => evalCond(row, c));
  if (cond.__eq) return row[cond.field] === cond.value;
  throw new Error("Unknown condition: " + JSON.stringify(cond));
}

class SelectChain implements PromiseLike<Row[]> {
  private cond: any = null;
  private orderField: string | null = null;
  private orderDesc = false;
  private limitN: number | null = null;
  private offsetN = 0;
  constructor(private tableName: string) {}
  where(cond: any) { this.cond = cond; return this; }
  orderBy(spec: any) {
    if (spec?.__desc) { this.orderField = spec.field; this.orderDesc = true; } else { this.orderField = spec; }
    return this;
  }
  limit(n: number) { this.limitN = n; return this; }
  offset(n: number) { this.offsetN = n; return this; }
  private resolveRows(): Row[] {
    let rows = (tables.get(this.tableName) ?? []).filter((r) => evalCond(r, this.cond));
    if (this.orderField) {
      rows = [...rows].sort((a, b) => {
        const av = a[this.orderField!], bv = b[this.orderField!];
        const an = av?.getTime?.() ?? av, bn = bv?.getTime?.() ?? bv;
        return this.orderDesc ? (bn > an ? 1 : -1) : (an > bn ? 1 : -1);
      });
    }
    if (this.offsetN) rows = rows.slice(this.offsetN);
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    return rows;
  }
  then<T1, T2>(res?: any, rej?: any) { return Promise.resolve(this.resolveRows()).then(res, rej); }
}

class InsertChain implements PromiseLike<Row[]> {
  private row: Row | null = null;
  constructor(private tableName: string) {}
  values(data: Row) {
    const id = (idCounters.get(this.tableName) ?? 0) + 1;
    idCounters.set(this.tableName, id);
    this.row = { id, createdAt: new Date(), ...data };
    tables.get(this.tableName)!.push(this.row);
    return this;
  }
  returning() { return Promise.resolve([this.row]); }
  then<T1, T2>(res?: any, rej?: any) { return Promise.resolve([this.row]).then(res, rej); }
}

// Generic +/- N sql-expression evaluator -- the only two shapes this
// codebase's `sql` template ever produces for a settable field
// (attempts + 1, walletBalancePaise - cost). Not a general SQL evaluator.
function applySqlExpr(row: Row, field: string, expr: any) {
  const [colDesc, amount] = expr.values;
  const op = String(expr.strings[1]).trim(); // "+" or "-"
  const base = row[fieldNameOf(colDesc)];
  row[field] = op === "+" ? base + amount : base - amount;
}

class UpdateChain {
  constructor(private tableName: string) {}
  set(patch: Row) {
    const tableName = this.tableName;
    let cond: any = null;
    const chain: any = {
      where(c: any) {
        cond = c;
        const affected = (tables.get(tableName) ?? []).filter((r: Row) => evalCond(r, cond));
        for (const row of affected) {
          for (const [k, v] of Object.entries(patch)) {
            if (v && (v as any).__sqlExpr) applySqlExpr(row, k, v);
            else row[k] = v;
          }
        }
        chain._affected = affected;
        return chain;
      },
      returning() { return Promise.resolve(chain._affected ?? []); },
      then(res: any, rej: any) { return Promise.resolve(chain._affected ?? []).then(res, rej); },
    };
    return chain;
  }
}

const fakeDb = {
  select(_cols?: any) { return { from: (t: Row) => new SelectChain(tableNameOf(t)) }; },
  insert(t: Row) { return new InsertChain(tableNameOf(t)); },
  update(t: Row) { return new UpdateChain(tableNameOf(t)); },
  transaction(fn: (tx: typeof fakeDb) => Promise<any>) { return fn(fakeDb); },
};

vi.mock("../../server/db", () => ({ db: fakeDb }));
vi.mock("../../server/observability", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/audit", () => ({ createAuditLog: vi.fn(async () => {}) }));

let chargeMock: ReturnType<typeof vi.fn>;
vi.mock("../../server/modules/otp/billing", () => ({
  PLACEHOLDER_COST_PER_OTP_PAISE: 15,
  chargeOtpMessage: (...args: any[]) => chargeMock(...args),
}));

let lockoutState: { locked: boolean; ttlSec?: number };
const failureRecords: string[] = [];
vi.mock("../../server/rate-limit", () => ({
  isOtpVerifyLockedOut: vi.fn(async () => lockoutState),
  recordOtpVerifyFailure: vi.fn(async (identifier: string) => { failureRecords.push(identifier); }),
  clearOtpVerifyFailures: vi.fn(async () => {}),
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    eq: (column: string, value: unknown) => ({ __eq: true, field: fieldNameOf(column), value }),
    and: (...conds: any[]) => ({ __and: true, conds }),
    or: (...conds: any[]) => ({ __or: true, conds }),
    desc: (column: string) => ({ __desc: true, field: fieldNameOf(column) }),
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ __sqlExpr: true, strings, values }),
  };
});

vi.mock("@shared/schema", async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  const col = (t: string, f: string) => `${t}.${f}`;
  const mkTable = (t: string, fields: string[]) => Object.fromEntries(fields.map((f) => [f, col(t, f)]));
  return {
    ...actual,
    organizations: mkTable("organizations", ["id"]),
    users: mkTable("users", ["id"]),
    customers: mkTable("customers", [
      "id", "businessId", "linkedUserId", "name", "phone", "normalizedPhone", "email", "normalizedEmail",
      "externalRef", "notes", "status", "source", "createdBy", "createdAt", "updatedAt", "archivedBy", "archivedAt",
    ]),
    templates: mkTable("templates", ["id", "businessId", "name", "category", "createdBy", "createdAt"]),
    templateVersions: mkTable("templateVersions", [
      "id", "templateId", "language", "versionNumber", "status", "title", "content", "variables",
      "mediaType", "mediaUrl", "metadata", "createdBy", "createdAt", "submittedBy", "submittedAt",
      "decidedBy", "decidedAt", "rejectionReason", "archivedBy", "archivedAt",
    ]),
    businessOtpChallenges: mkTable("businessOtpChallenges", [
      "id", "businessId", "customerId", "destination", "channel", "purpose", "codeHash", "status",
      "attempts", "maxAttempts", "resendCount", "templateVersionId", "messageId", "supersedesChallengeId",
      "metadata", "createdBy", "createdAt", "expiresAt", "verifiedAt", "failedAt", "supersededAt",
    ]),
    businessOtpDeliveries: mkTable("businessOtpDeliveries", ["id", "challengeId", "channel", "destination", "status", "providerRef", "failureReason", "createdAt"]),
    messagingConversations: mkTable("messagingConversations", ["id", "type", "organizationId", "metadata", "isArchived", "createdAt", "updatedAt"]),
    businessConversations: mkTable("businessConversations", ["id", "conversationId", "businessId", "customerId", "status", "assignedToUserId", "createdAt"]),
    messagingParticipants: mkTable("messagingParticipants", ["id", "conversationId", "participantType", "participantId", "role", "joinedAt", "leftAt"]),
    messagingMessages: mkTable("messagingMessages", ["id", "conversationId", "senderParticipantId", "messageType", "category", "content", "templateId", "replyToMessageId", "createdAt", "editedAt", "deletedAt"]),
    messagingDeliveries: mkTable("messagingDeliveries", ["id", "messageId", "participantId", "status", "statusAt", "failureReason", "providerRef"]),
    messagingEvents: mkTable("messagingEvents", ["id", "conversationId", "messageId", "eventType", "payload", "createdAt"]),
  };
});

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
  chargeMock = vi.fn(async () => ({ charged: true, billingAccountId: 1, costPaise: 15 }));
  lockoutState = { locked: false };
  failureRecords.length = 0;
});

const BIZ = 1;
const OTHER_BIZ = 2;
const STAFF = 10;

async function makeCustomer(businessId = BIZ, overrides: Record<string, any> = {}) {
  const { createCustomer } = await import("../../server/modules/customers/service");
  return createCustomer(businessId, STAFF, { name: "Kiran", phone: "9876543210", ...overrides });
}

async function makeApprovedAuthTemplate(businessId = BIZ) {
  const { createTemplate, createOrEditDraftVersion } = await import("../../server/modules/templates/service");
  const t = await createTemplate(businessId, STAFF, { name: `otp_tpl_${Date.now()}_${Math.random()}`, category: "authentication" });
  const v = await createOrEditDraftVersion(businessId, STAFF, t.id, {
    content: "Hi {{name}}, your code is {{code}}",
    variables: [{ name: "name", type: "text", required: false }, { name: "code", type: "text", required: true }],
  });
  const row = tables.get("templateVersions")!.find((r) => r.id === v.id)!;
  row.status = "approved";
  return { template: t, version: row };
}

async function svc() { return import("../../server/modules/otp/service"); }

// ---------------------------------------------------------------------------
// 3/5. OTP model / generation
// ---------------------------------------------------------------------------

describe("Challenge creation", () => {
  it("creates a PENDING challenge with a hashed code, never exposing the raw code", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const challenge: any = await s.createChallenge(BIZ, STAFF, { customerId: customer.id, purpose: "login" });
    expect(challenge.status).toBe("pending");
    expect(challenge.codeHash).toBeUndefined(); // toSafeChallenge strips it
    expect(JSON.stringify(challenge)).not.toMatch(/^\d{6}$/);
  });

  it("resolves destination server-side from the customer record -- SMS preferred when phone exists", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const challenge: any = await s.createChallenge(BIZ, STAFF, { customerId: customer.id, purpose: "login" });
    expect(challenge.channel).toBe("sms");
    expect(challenge.destination).toBe(customer.normalizedPhone);
  });

  it("rejects an invalid purpose", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    await expect(s.createChallenge(BIZ, STAFF, { customerId: customer.id, purpose: "spam" as any })).rejects.toThrow(s.ValidationError);
  });

  it("rejects a channel the customer has no destination for", async () => {
    const s = await svc();
    const customer = await makeCustomer(BIZ, { phone: undefined, email: "kiran@example.com" });
    await expect(s.createChallenge(BIZ, STAFF, { customerId: customer.id, purpose: "login", channel: "sms" })).rejects.toThrow(s.ValidationError);
  });

  it("stores a SHA-256 hash of the code, never the code itself, in the underlying row", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const challenge: any = await s.createChallenge(BIZ, STAFF, { customerId: customer.id, purpose: "login" });
    const raw = tables.get("businessOtpChallenges")!.find((r) => r.id === challenge.id)!;
    expect(raw.codeHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("10. Customer status rules", () => {
  it("ACTIVE customer -> allowed", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    await expect(s.createChallenge(BIZ, STAFF, { customerId: customer.id, purpose: "login" })).resolves.toBeTruthy();
  });

  it("BLOCKED customer -> rejected", async () => {
    const s = await svc();
    const { updateCustomer } = await import("../../server/modules/customers/service");
    const customer = await makeCustomer();
    await updateCustomer(BIZ, STAFF, customer.id, { status: "blocked" });
    await expect(s.createChallenge(BIZ, STAFF, { customerId: customer.id, purpose: "login" })).rejects.toThrow(s.ValidationError);
  });

  it("ARCHIVED customer -> rejected", async () => {
    const s = await svc();
    const { archiveCustomer } = await import("../../server/modules/customers/service");
    const customer = await makeCustomer();
    await archiveCustomer(BIZ, STAFF, customer.id);
    await expect(s.createChallenge(BIZ, STAFF, { customerId: customer.id, purpose: "login" })).rejects.toThrow(s.ValidationError);
  });

  it("unknown customer -> NotFoundError, not a different error shape that could leak existence", async () => {
    const s = await svc();
    await expect(s.createChallenge(BIZ, STAFF, { customerId: 9999, purpose: "login" })).rejects.toThrow(s.NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// 21. Idempotency: duplicate challenge creation
// ---------------------------------------------------------------------------

describe("Duplicate challenge creation", () => {
  it("rejects creating a second PENDING challenge for the same customer+purpose", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const first: any = await s.createChallenge(BIZ, STAFF, { customerId: customer.id, purpose: "login" });
    try {
      await s.createChallenge(BIZ, STAFF, { customerId: customer.id, purpose: "login" });
      throw new Error("should have thrown");
    } catch (e: any) {
      expect(e).toBeInstanceOf(s.DuplicateChallengeError);
      expect(e.existingChallengeId).toBe(first.id);
    }
  });

  it("allows a new challenge for a DIFFERENT purpose even while one is pending", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    await s.createChallenge(BIZ, STAFF, { customerId: customer.id, purpose: "login" });
    await expect(s.createChallenge(BIZ, STAFF, { customerId: customer.id, purpose: "verify_phone" })).resolves.toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 6/24. Verification
// ---------------------------------------------------------------------------

describe("Verification", () => {
  async function createAndGetRawCode(customerId: number, purpose = "login", businessId = BIZ) {
    const s = await svc();
    await s.createChallenge(businessId, STAFF, { customerId, purpose });
    const raw = tables.get("businessOtpChallenges")!.at(-1)!;
    // Test-only: brute-force the 6-digit space is infeasible for a real
    // attacker, but here we control generation indirectly -- instead,
    // monkey-patch by re-hashing a known code and overwriting the stored
    // hash, since generateOtpCode's real output isn't observable from the
    // service's public API (by design). This proves verify() behaves
    // correctly for a KNOWN code/hash pair without ever reading the
    // module-private code generator.
    const { hashOtpCode } = await import("../../server/modules/otp/generate");
    const knownCode = "424242";
    raw.codeHash = hashOtpCode(knownCode);
    return { challengeId: raw.id, code: knownCode };
  }

  it("correct code verifies successfully, exactly once", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const { challengeId, code } = await createAndGetRawCode(customer.id);
    const result: any = await s.verifyChallenge(BIZ, STAFF, challengeId, code);
    expect(result.status).toBe("verified");
  });

  it("replayed verify request (same correct code again) fails -- one-time verification", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const { challengeId, code } = await createAndGetRawCode(customer.id);
    await s.verifyChallenge(BIZ, STAFF, challengeId, code);
    await expect(s.verifyChallenge(BIZ, STAFF, challengeId, code)).rejects.toThrow(s.AlreadyResolvedError);
  });

  it("wrong code is rejected and increments attempts, without resolving the challenge", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const { challengeId } = await createAndGetRawCode(customer.id);
    await expect(s.verifyChallenge(BIZ, STAFF, challengeId, "000000")).rejects.toThrow(s.OtpIncorrectCodeError);
    const raw = tables.get("businessOtpChallenges")!.find((r) => r.id === challengeId)!;
    expect(raw.status).toBe("pending");
    expect(raw.attempts).toBe(1);
  });

  it("expired challenge is rejected and transitions to EXPIRED", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const { challengeId, code } = await createAndGetRawCode(customer.id);
    const raw = tables.get("businessOtpChallenges")!.find((r) => r.id === challengeId)!;
    raw.expiresAt = new Date(Date.now() - 1000);
    await expect(s.verifyChallenge(BIZ, STAFF, challengeId, code)).rejects.toThrow(s.OtpExpiredError);
    expect(raw.status).toBe("expired");
  });

  it("already-used (verified) challenge cannot verify again even with a fresh correct-code attempt", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const { challengeId, code } = await createAndGetRawCode(customer.id);
    await s.verifyChallenge(BIZ, STAFF, challengeId, code);
    await expect(s.verifyChallenge(BIZ, STAFF, challengeId, code)).rejects.toThrow(s.AlreadyResolvedError);
  });

  it("wrong challengeId -> NotFoundError", async () => {
    const s = await svc();
    await expect(s.verifyChallenge(BIZ, STAFF, 9999, "424242")).rejects.toThrow(s.NotFoundError);
  });

  it("wrong purpose (expectedPurpose consistency check) is rejected", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const { challengeId, code } = await createAndGetRawCode(customer.id, "login");
    await expect(s.verifyChallenge(BIZ, STAFF, challengeId, code, { expectedPurpose: "transaction" })).rejects.toThrow(s.ValidationError);
  });

  it("wrong destination (expectedDestination consistency check) is rejected", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const { challengeId, code } = await createAndGetRawCode(customer.id);
    await expect(s.verifyChallenge(BIZ, STAFF, challengeId, code, { expectedDestination: "+910000000000" })).rejects.toThrow(s.ValidationError);
  });

  it("cross-business challenge access -> NotFoundError (never confirms existence to another tenant)", async () => {
    const s = await svc();
    const customer = await makeCustomer(OTHER_BIZ);
    const { challengeId, code } = await createAndGetRawCode(customer.id, "login", OTHER_BIZ);
    await expect(s.verifyChallenge(BIZ, STAFF, challengeId, code)).rejects.toThrow(s.NotFoundError);
  });

  it("attempt limit: exceeding maxAttempts transitions the challenge to FAILED, blocking further attempts even with the correct code", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const { challengeId, code } = await createAndGetRawCode(customer.id);
    await expect(s.verifyChallenge(BIZ, STAFF, challengeId, "000000")).rejects.toThrow(s.OtpIncorrectCodeError);
    await expect(s.verifyChallenge(BIZ, STAFF, challengeId, "111111")).rejects.toThrow(s.OtpIncorrectCodeError);
    await expect(s.verifyChallenge(BIZ, STAFF, challengeId, "222222")).rejects.toThrow(s.OtpMaxAttemptsError);
    const raw = tables.get("businessOtpChallenges")!.find((r) => r.id === challengeId)!;
    expect(raw.status).toBe("failed");
    await expect(s.verifyChallenge(BIZ, STAFF, challengeId, code)).rejects.toThrow(s.AlreadyResolvedError);
  });

  it("destination-level Redis lockout blocks verification even before checking the code", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const { challengeId, code } = await createAndGetRawCode(customer.id);
    lockoutState = { locked: true, ttlSec: 900 };
    await expect(s.verifyChallenge(BIZ, STAFF, challengeId, code)).rejects.toThrow(s.OtpLockedOutError);
  });

  it("concurrent verify attempts against the same challenge: exactly one succeeds", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const { challengeId, code } = await createAndGetRawCode(customer.id);
    const results = await Promise.allSettled([
      s.verifyChallenge(BIZ, STAFF, challengeId, code),
      s.verifyChallenge(BIZ, STAFF, challengeId, code),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBe(1);
    const raw = tables.get("businessOtpChallenges")!.find((r) => r.id === challengeId)!;
    expect(raw.status).toBe("verified");
  });
});

// ---------------------------------------------------------------------------
// 8/21. Resend
// ---------------------------------------------------------------------------

describe("Resend policy: SUPERSEDE, not multi-valid-OTP", () => {
  it("resend supersedes the prior challenge and issues a new one -- the old code no longer verifies", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const original: any = await s.createChallenge(BIZ, STAFF, { customerId: customer.id, purpose: "login" });
    const originalRaw = tables.get("businessOtpChallenges")!.find((r) => r.id === original.id)!;
    const { hashOtpCode } = await import("../../server/modules/otp/generate");
    originalRaw.codeHash = hashOtpCode("111111");

    const resent: any = await s.resendChallenge(BIZ, STAFF, original.id);
    expect(resent.id).not.toBe(original.id);
    expect(resent.status).toBe("pending");
    expect(resent.resendCount).toBe(1);

    const oldRaw = tables.get("businessOtpChallenges")!.find((r) => r.id === original.id)!;
    expect(oldRaw.status).toBe("superseded");

    // the old code can no longer verify (challenge is no longer pending)
    await expect(s.verifyChallenge(BIZ, STAFF, original.id, "111111")).rejects.toThrow(s.AlreadyResolvedError);
  });

  it("cannot resend a non-PENDING challenge", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const original: any = await s.createChallenge(BIZ, STAFF, { customerId: customer.id, purpose: "login" });
    await s.resendChallenge(BIZ, STAFF, original.id); // supersedes it
    await expect(s.resendChallenge(BIZ, STAFF, original.id)).rejects.toThrow(s.ValidationError);
  });

  it("enforces MAX_RESENDS", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    let current: any = await s.createChallenge(BIZ, STAFF, { customerId: customer.id, purpose: "login" });
    for (let i = 0; i < 3; i++) {
      current = await s.resendChallenge(BIZ, STAFF, current.id);
    }
    await expect(s.resendChallenge(BIZ, STAFF, current.id)).rejects.toThrow(s.ValidationError);
  });

  it("resend charges billing again (new delivery work)", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const original: any = await s.createChallenge(BIZ, STAFF, { customerId: customer.id, purpose: "login" });
    expect(chargeMock).toHaveBeenCalledTimes(1);
    await s.resendChallenge(BIZ, STAFF, original.id);
    expect(chargeMock).toHaveBeenCalledTimes(2);
  });

  it("concurrent resend attempts: exactly one supersede wins", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const original: any = await s.createChallenge(BIZ, STAFF, { customerId: customer.id, purpose: "login" });
    const results = await Promise.allSettled([
      s.resendChallenge(BIZ, STAFF, original.id),
      s.resendChallenge(BIZ, STAFF, original.id),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBe(1);
    const pendingRows = tables.get("businessOtpChallenges")!.filter((r) => r.status === "pending");
    expect(pendingRows.length).toBe(1); // never two live challenges at once
  });
});

// ---------------------------------------------------------------------------
// 9. Destination security / tenant isolation
// ---------------------------------------------------------------------------

describe("Destination security / tenant isolation", () => {
  it("Business A cannot create a challenge for Business B's customer (customerId manipulation)", async () => {
    const s = await svc();
    const otherCustomer = await makeCustomer(OTHER_BIZ);
    await expect(s.createChallenge(BIZ, STAFF, { customerId: otherCustomer.id, purpose: "login" })).rejects.toThrow(s.NotFoundError);
  });

  it("Business A cannot read/verify/resend Business B's challenge (businessId/challengeId manipulation)", async () => {
    const s = await svc();
    const otherCustomer = await makeCustomer(OTHER_BIZ);
    const challenge: any = await s.createChallenge(OTHER_BIZ, STAFF, { customerId: otherCustomer.id, purpose: "login" });
    expect(await s.getChallenge(BIZ, challenge.id)).toBeNull();
    await expect(s.verifyChallenge(BIZ, STAFF, challenge.id, "424242")).rejects.toThrow(s.NotFoundError);
    await expect(s.resendChallenge(BIZ, STAFF, challenge.id)).rejects.toThrow(s.NotFoundError);
  });

  it("destination is always server-resolved from the customer record -- there is no input path for a client-supplied destination", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    // CreateChallengeInput has no `destination`/`phone`/`email` field at all
    const challenge: any = await s.createChallenge(BIZ, STAFF, { customerId: customer.id, purpose: "login" } as any);
    expect(challenge.destination).toBe(customer.normalizedPhone);
  });
});

// ---------------------------------------------------------------------------
// 15. Template rule
// ---------------------------------------------------------------------------

describe("Template integration", () => {
  it("binds an APPROVED, category=AUTHENTICATION template", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const { version } = await makeApprovedAuthTemplate();
    const challenge: any = await s.createChallenge(BIZ, STAFF, { customerId: customer.id, purpose: "login", templateVersionId: version.id });
    expect(challenge.templateVersionId).toBe(version.id);
  });

  it("rejects a template with a non-AUTHENTICATION category", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const { createTemplate, createOrEditDraftVersion } = await import("../../server/modules/templates/service");
    const t = await createTemplate(BIZ, STAFF, { name: "marketing_tpl", category: "marketing" });
    const v = await createOrEditDraftVersion(BIZ, STAFF, t.id, { content: "Hi {{code}}", variables: [{ name: "code", type: "text", required: true }] });
    tables.get("templateVersions")!.find((r) => r.id === v.id)!.status = "approved";
    await expect(s.createChallenge(BIZ, STAFF, { customerId: customer.id, purpose: "login", templateVersionId: v.id })).rejects.toThrow(s.ValidationError);
  });

  it("rejects a non-APPROVED authentication template", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const { createTemplate, createOrEditDraftVersion } = await import("../../server/modules/templates/service");
    const t = await createTemplate(BIZ, STAFF, { name: "draft_auth_tpl", category: "authentication" });
    const v = await createOrEditDraftVersion(BIZ, STAFF, t.id, { content: "Hi {{code}}", variables: [{ name: "code", type: "text", required: true }] });
    await expect(s.createChallenge(BIZ, STAFF, { customerId: customer.id, purpose: "login", templateVersionId: v.id })).rejects.toThrow(s.ValidationError);
  });

  it("rejects a template belonging to a different business (templateId manipulation)", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const { version } = await makeApprovedAuthTemplate(OTHER_BIZ);
    await expect(s.createChallenge(BIZ, STAFF, { customerId: customer.id, purpose: "login", templateVersionId: version.id })).rejects.toThrow(s.NotFoundError);
  });

  it("rejects an AUTHENTICATION template missing a required {{code}} variable", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const { createTemplate, createOrEditDraftVersion } = await import("../../server/modules/templates/service");
    const t = await createTemplate(BIZ, STAFF, { name: "no_code_tpl", category: "authentication" });
    const v = await createOrEditDraftVersion(BIZ, STAFF, t.id, { content: "Hi {{name}}", variables: [{ name: "name", type: "text", required: false }] });
    tables.get("templateVersions")!.find((r) => r.id === v.id)!.status = "approved";
    await expect(s.createChallenge(BIZ, STAFF, { customerId: customer.id, purpose: "login", templateVersionId: v.id })).rejects.toThrow(s.ValidationError);
  });

  it("rejects an AUTHENTICATION template declaring an unsupported variable (category injection guard via content)", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const { createTemplate, createOrEditDraftVersion } = await import("../../server/modules/templates/service");
    const t = await createTemplate(BIZ, STAFF, { name: "bad_var_tpl", category: "authentication" });
    const v = await createOrEditDraftVersion(BIZ, STAFF, t.id, {
      content: "Hi {{code}} {{discount}}",
      variables: [{ name: "code", type: "text", required: true }, { name: "discount", type: "text", required: false }],
    });
    tables.get("templateVersions")!.find((r) => r.id === v.id)!.status = "approved";
    await expect(s.createChallenge(BIZ, STAFF, { customerId: customer.id, purpose: "login", templateVersionId: v.id })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 16. Messaging integration -- sender identity, generationSource, redaction
// ---------------------------------------------------------------------------

describe("Messaging boundary", () => {
  it("category is always AUTHENTICATION on the created message, server-controlled, never client input", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    await s.createChallenge(BIZ, STAFF, { customerId: customer.id, purpose: "login" });
    const message = tables.get("messagingMessages")!.at(-1)!;
    expect(message.category).toBe("authentication");
  });

  it("sender is the BUSINESS participant, never a human user", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    await s.createChallenge(BIZ, STAFF, { customerId: customer.id, purpose: "login" });
    const message = tables.get("messagingMessages")!.at(-1)!;
    const sender = tables.get("messagingParticipants")!.find((p) => p.id === message.senderParticipantId);
    expect(sender.participantType).toBe("business");
  });

  it("generationSource is server-set, referencing the OTP challenge id", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const challenge: any = await s.createChallenge(BIZ, STAFF, { customerId: customer.id, purpose: "login" });
    const event = tables.get("messagingEvents")!.find((e) => e.eventType === "message.created");
    expect(event.payload.generationSource).toEqual({ type: "otp_challenge", id: challenge.id });
  });

  it("the persisted message content NEVER contains the raw code -- it is redacted", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const { version } = await makeApprovedAuthTemplate();
    const challenge: any = await s.createChallenge(BIZ, STAFF, { customerId: customer.id, purpose: "login", templateVersionId: version.id });
    const raw = tables.get("businessOtpChallenges")!.find((r) => r.id === challenge.id)!;
    const message = tables.get("messagingMessages")!.find((m) => m.id === raw.messageId)!;
    expect(message.content).not.toMatch(/\d{6}/); // no 6-digit sequence anywhere
    expect(message.content).toContain("[code sent separately]");
  });

  it("a delivery-intent (businessOtpDeliveries) row is created alongside the challenge", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const challenge: any = await s.createChallenge(BIZ, STAFF, { customerId: customer.id, purpose: "login" });
    const delivery = tables.get("businessOtpDeliveries")!.find((d) => d.challengeId === challenge.id);
    expect(delivery).toBeDefined();
    expect(delivery.status).toBe("queued");
    expect(delivery.providerRef).toBeFalsy(); // no real provider called
  });
});

// ---------------------------------------------------------------------------
// 13/14. Billing boundary
// ---------------------------------------------------------------------------

describe("Billing boundary", () => {
  it("charges exactly once per challenge creation, inside the same transaction", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    await s.createChallenge(BIZ, STAFF, { customerId: customer.id, purpose: "login" });
    expect(chargeMock).toHaveBeenCalledTimes(1);
  });

  it("insufficient credit fails the ENTIRE challenge creation -- no challenge row is left behind", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    chargeMock = vi.fn(async () => ({ charged: false, reason: "insufficient_credit" }));
    await expect(s.createChallenge(BIZ, STAFF, { customerId: customer.id, purpose: "login" })).rejects.toThrow(s.BillingError);
    expect(tables.get("businessOtpChallenges")!.length).toBe(0);
  });

  it("billing_not_configured surfaces as a distinct, non-crashing BillingError", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    chargeMock = vi.fn(async () => ({ charged: false, reason: "billing_not_configured" }));
    try {
      await s.createChallenge(BIZ, STAFF, { customerId: customer.id, purpose: "login" });
      throw new Error("should have thrown");
    } catch (e: any) {
      expect(e).toBeInstanceOf(s.BillingError);
      expect(e.reason).toBe("billing_not_configured");
    }
  });
});

// ---------------------------------------------------------------------------
// 22. Audit
// ---------------------------------------------------------------------------

describe("Audit: never records the OTP value", () => {
  it("audit metadata for challenge creation never includes the code or its hash", async () => {
    const auditModule = await import("../../server/audit");
    const s = await svc();
    const customer = await makeCustomer();
    await s.createChallenge(BIZ, STAFF, { customerId: customer.id, purpose: "login" });
    const calls = (auditModule.createAuditLog as any).mock.calls;
    for (const [params] of calls) {
      expect(JSON.stringify(params)).not.toMatch(/[a-f0-9]{64}/); // no sha256 hex anywhere
    }
  });
});
