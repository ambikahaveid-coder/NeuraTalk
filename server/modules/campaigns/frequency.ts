/**
 * Marketing frequency / throughput caps -- Phase 8 hardening (2026-08-24).
 * See docs/neura-ecosystem/34_PHASE8_MARKETING_HARDENING_IMPLEMENTATION.md
 * section 3.
 *
 * Two atomic, DB-backed counters (customer_marketing_frequency,
 * business_marketing_throughput) -- each reservation is a single atomic
 * conditional operation (insert-if-absent, else conditional increment
 * bounded by the cap), the SAME CAS idiom used everywhere else in this
 * codebase (billing, campaign recipients, OTP challenges, utility events).
 * This is intentionally NOT built on server/rate-limit.ts's Redis
 * `rateLimit()` factory -- that factory is IP/route-scoped middleware;
 * this needs durable, atomic, per-(business,customer) accounting that a
 * concurrent recipient-processing transaction can safely race against.
 *
 * Only ever consulted for MARKETING-category campaigns (doc 34 section 3
 * -- frequency capping is a marketing-specific anti-spam control, never
 * applied to utility/operational messaging).
 */
import { db } from "../../db";
import { customerMarketingFrequency, businessMarketingThroughput } from "@shared/schema";
import { eq, and, lt, inArray, sql } from "drizzle-orm";

type DbLike = Pick<typeof db, "select" | "update" | "insert">;
type ReadOnlyDbLike = Pick<typeof db, "select">;

// CONFIGURABLE / PRODUCT DECISION -- not a legal requirement. These are
// safe technical defaults chosen so the gate has a real, testable effect;
// a future product/legal decision may set these per-business or per-
// jurisdiction. Window granularity (daily / hourly) is likewise a policy
// choice, not derived from any regulation.
export const DEFAULT_CUSTOMER_MARKETING_CAP_PER_DAY = 3;
export const DEFAULT_BUSINESS_MARKETING_THROUGHPUT_PER_HOUR = 1000;

export function startOfUtcDay(at: Date = new Date()): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}
export function startOfUtcHour(at: Date = new Date()): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), at.getUTCHours()));
}

function isUniqueViolation(err: unknown): boolean {
  const code = (err as any)?.code ?? (err as any)?.cause?.code;
  return code === "23505";
}

export interface FrequencyReservation {
  allowed: boolean;
}

/**
 * Atomically reserves one send against the per-customer daily marketing
 * cap. The INSERT itself is the atomic claim for the first send in a new
 * window; a concurrent/subsequent send in the SAME window races on the
 * conditional UPDATE (`WHERE sent_count < cap`), which is what makes this
 * provably safe under genuine concurrency -- not an app-level
 * read-then-write.
 */
export async function reserveCustomerFrequencySlot(
  tx: DbLike,
  businessId: number,
  customerId: number,
  windowStart: Date = startOfUtcDay(),
  cap: number = DEFAULT_CUSTOMER_MARKETING_CAP_PER_DAY,
): Promise<FrequencyReservation> {
  try {
    await tx.insert(customerMarketingFrequency).values({ businessId, customerId, windowStart, sentCount: 1 });
    return { allowed: true };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const [updated] = await tx.update(customerMarketingFrequency)
      .set({ sentCount: sql`${customerMarketingFrequency.sentCount} + ${1}`, updatedAt: new Date() })
      .where(and(
        eq(customerMarketingFrequency.businessId, businessId),
        eq(customerMarketingFrequency.customerId, customerId),
        eq(customerMarketingFrequency.windowStart, windowStart),
        lt(customerMarketingFrequency.sentCount, cap),
      ))
      .returning();
    return { allowed: !!updated };
  }
}

/** Same atomic idiom, business-scoped instead of customer-scoped -- the per-business throughput gate. */
export async function reserveBusinessThroughputSlot(
  tx: DbLike,
  businessId: number,
  windowStart: Date = startOfUtcHour(),
  cap: number = DEFAULT_BUSINESS_MARKETING_THROUGHPUT_PER_HOUR,
): Promise<FrequencyReservation> {
  try {
    await tx.insert(businessMarketingThroughput).values({ businessId, windowStart, sentCount: 1 });
    return { allowed: true };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const [updated] = await tx.update(businessMarketingThroughput)
      .set({ sentCount: sql`${businessMarketingThroughput.sentCount} + ${1}`, updatedAt: new Date() })
      .where(and(
        eq(businessMarketingThroughput.businessId, businessId),
        eq(businessMarketingThroughput.windowStart, windowStart),
        lt(businessMarketingThroughput.sentCount, cap),
      ))
      .returning();
    return { allowed: !!updated };
  }
}

// ---------------------------------------------------------------------------
// Read-only visibility -- Phase 8B-R0 (2026-08-24). See
// docs/neura-ecosystem/36_PHASE8B_R0_REPORTING_PREFLIGHT_IMPLEMENTATION.md
// section "R0-E". These NEVER write -- pre-flight and reporting must be
// pure previews, never side-effecting reservations (doc 35 section "no
// mutation from a read call"). Distinct from reserve*Slot above, which
// are the only functions allowed to mutate these counters.
// ---------------------------------------------------------------------------

export interface FrequencyStatus {
  windowStart: Date;
  cap: number;
  used: number;
  remaining: number;
}

export async function peekBusinessThroughputStatus(
  tx: ReadOnlyDbLike,
  businessId: number,
  windowStart: Date = startOfUtcHour(),
  cap: number = DEFAULT_BUSINESS_MARKETING_THROUGHPUT_PER_HOUR,
): Promise<FrequencyStatus> {
  const [row] = await tx.select().from(businessMarketingThroughput)
    .where(and(eq(businessMarketingThroughput.businessId, businessId), eq(businessMarketingThroughput.windowStart, windowStart)));
  const used = row?.sentCount ?? 0;
  return { windowStart, cap, used, remaining: Math.max(0, cap - used) };
}

export async function peekCustomerFrequencyStatus(
  tx: ReadOnlyDbLike,
  businessId: number,
  customerId: number,
  windowStart: Date = startOfUtcDay(),
  cap: number = DEFAULT_CUSTOMER_MARKETING_CAP_PER_DAY,
): Promise<FrequencyStatus> {
  const [row] = await tx.select().from(customerMarketingFrequency)
    .where(and(eq(customerMarketingFrequency.businessId, businessId), eq(customerMarketingFrequency.customerId, customerId), eq(customerMarketingFrequency.windowStart, windowStart)));
  const used = row?.sentCount ?? 0;
  return { windowStart, cap, used, remaining: Math.max(0, cap - used) };
}

/** Batch version for pre-flight -- one query for up to N customers, not N queries. Returns the set of customerIds that are ALREADY at/over the cap for the given window. */
export async function findCustomersAtFrequencyCap(
  tx: ReadOnlyDbLike,
  businessId: number,
  customerIds: number[],
  windowStart: Date = startOfUtcDay(),
  cap: number = DEFAULT_CUSTOMER_MARKETING_CAP_PER_DAY,
): Promise<Set<number>> {
  if (customerIds.length === 0) return new Set();
  const rows = await tx.select().from(customerMarketingFrequency).where(and(
    eq(customerMarketingFrequency.businessId, businessId),
    eq(customerMarketingFrequency.windowStart, windowStart),
    inArray(customerMarketingFrequency.customerId, customerIds),
  ));
  return new Set(rows.filter((r) => r.sentCount >= cap).map((r) => r.customerId));
}
