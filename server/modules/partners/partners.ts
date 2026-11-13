/**
 * Partners (resellers / white-label): a partner sells NeuraTalk Business under
 * its own brand, like a WhatsApp Business reseller panel.
 *
 *   NeuraTalk super admin            Partner (own logo, name, colours)          Partner's business
 *   - creates partners               - creates and manages its businesses      - sees "Managed by <partner>"
 *   - wholesale rates + bonus %      - buys wholesale credit (UTR → confirmed)  - pays the partner (partner's UPI)
 *   - confirms partner top-ups       - gives credit / plans to its businesses   - partner confirms → credit / plan
 *   - pauses a partner               - confirms its businesses' payments
 *
 * Money: a partner's wallet is real money paid to NeuraTalk. Everything a
 * partner gives a business comes out of that wallet in the same database
 * transaction, so a partner can never hand out more than it paid for.
 * Partners only ever see their own businesses (partner_businesses).
 */
import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { AUDIT_ACTION } from "@shared/schema";
import { BUSINESS_MESSAGING_SETTINGS_KEY, businessMessagingSettingsSchema } from "../messaging/business-directory";
import { normalizePhoneForIndia } from "@shared/phone";
import { requireAuth, requireRole } from "../../role-middleware";
import { createAuditLog } from "../../audit";
import { logger } from "../../observability";

const rows = <T>(r: unknown) => (r as { rows: T[] }).rows;
export const MIN_PARTNER_TOPUP_PAISE = 500_000; // ₹5,000
const PARTNER_PAUSE_PREFIX = "Paused by partner";

export async function ensurePartnerTables(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "partners" (
      "id" serial PRIMARY KEY NOT NULL,
      "name" text NOT NULL,
      "brand_name" text NOT NULL,
      "slug" text NOT NULL UNIQUE,
      "logo_url" text,
      "primary_color" text,
      "support_email" text,
      "support_phone" text,
      "status" text NOT NULL DEFAULT 'active',
      "pause_reason" text,
      "bonus_percent" integer NOT NULL DEFAULT 0,
      "marketing_paise" integer,
      "utility_paise" integer,
      "otp_paise" integer,
      "payment_details" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "wallet_paise" bigint NOT NULL DEFAULT 0,
      "created_by" integer,
      "created_at" timestamp DEFAULT now(),
      "updated_at" timestamp DEFAULT now()
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "partner_members" (
      "partner_id" integer NOT NULL REFERENCES "partners"("id") ON DELETE CASCADE,
      "user_id" integer NOT NULL,
      "role" text NOT NULL DEFAULT 'staff',
      "created_at" timestamp DEFAULT now(),
      PRIMARY KEY ("partner_id", "user_id")
    )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "partner_members_user_idx" ON "partner_members" ("user_id")`);
  // A business belongs to at most one partner.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "partner_businesses" (
      "business_id" integer PRIMARY KEY NOT NULL,
      "partner_id" integer NOT NULL REFERENCES "partners"("id") ON DELETE CASCADE,
      "created_at" timestamp DEFAULT now()
    )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "partner_businesses_partner_idx" ON "partner_businesses" ("partner_id")`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "partner_ledger" (
      "id" bigserial PRIMARY KEY NOT NULL,
      "partner_id" integer NOT NULL,
      "kind" text NOT NULL,
      "amount_paise" bigint NOT NULL,
      "balance_after_paise" bigint NOT NULL,
      "business_id" integer,
      "reference" text,
      "note" text,
      "created_by" integer,
      "created_at" timestamp DEFAULT now()
    )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "partner_ledger_partner_idx" ON "partner_ledger" ("partner_id", "created_at")`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "partner_topups" (
      "id" serial PRIMARY KEY NOT NULL,
      "partner_id" integer NOT NULL,
      "amount_paise" bigint NOT NULL,
      "credit_paise" bigint NOT NULL,
      "method" text NOT NULL,
      "payment_reference" text NOT NULL,
      "status" text NOT NULL DEFAULT 'pending',
      "requested_by" integer NOT NULL,
      "decided_by" integer,
      "decided_at" timestamp,
      "decision_note" text,
      "created_at" timestamp DEFAULT now()
    )`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "partner_topups_ref_once"
    ON "partner_topups" (lower("payment_reference")) WHERE "status" IN ('pending', 'approved')`);
  // Business payments a partner confirms (business_recharge_requests from billing/message-credits.ts).
  await db.execute(sql`ALTER TABLE "business_recharge_requests" ADD COLUMN IF NOT EXISTS "partner_id" integer`);
}

// ------------------------------------------------------------------ helpers

type PartnerRow = {
  id: number; name: string; brand_name: string; slug: string; logo_url: string | null; primary_color: string | null;
  support_email: string | null; support_phone: string | null; status: string; pause_reason: string | null; bonus_percent: number;
  marketing_paise: number | null; utility_paise: number | null; otp_paise: number | null; payment_details: Record<string, string> | null;
  wallet_paise: string | number; created_at: Date;
};

export type PartnerBrand = { id: number; brandName: string; slug: string; logoUrl: string | null; primaryColor: string | null; supportEmail: string | null; supportPhone: string | null };
const brandOf = (p: PartnerRow): PartnerBrand => ({ id: p.id, brandName: p.brand_name, slug: p.slug, logoUrl: p.logo_url, primaryColor: p.primary_color, supportEmail: p.support_email, supportPhone: p.support_phone });

const presentPartner = (p: PartnerRow) => ({
  ...brandOf(p), name: p.name, status: p.status, pauseReason: p.pause_reason, bonusPercent: p.bonus_percent,
  rates: { marketingPaise: p.marketing_paise, utilityPaise: p.utility_paise, otpPaise: p.otp_paise },
  paymentDetails: { upiId: "", payeeName: "", bankName: "", accountNumber: "", ifsc: "", note: "", ...(p.payment_details ?? {}) },
  walletPaise: Number(p.wallet_paise), createdAt: p.created_at,
});

/** The partner that manages this business, or null (sold directly by NeuraTalk). */
export async function partnerOfBusiness(businessId: number): Promise<PartnerRow | null> {
  try {
    const [p] = rows<PartnerRow>(await db.execute(sql`
      SELECT p.* FROM partner_businesses pb JOIN partners p ON p.id = pb.partner_id WHERE pb.business_id = ${businessId}`));
    return p ?? null;
  } catch {
    return null; // tables not created yet
  }
}

/** For billing/message-credits and pricing: brand, how the business pays, and wholesale rates. */
export async function partnerContextForBusiness(businessId: number) {
  const p = await partnerOfBusiness(businessId);
  if (!p) return null;
  const pd = presentPartner(p).paymentDetails;
  return {
    partnerId: p.id,
    brand: brandOf(p),
    payment: { ...pd, ready: Boolean(pd.upiId || (pd.accountNumber && pd.ifsc)) },
    rates: { marketingPaise: p.marketing_paise, utilityPaise: p.utility_paise, otpPaise: p.otp_paise },
  };
}

async function membership(userId: number, partnerId: number): Promise<string | null> {
  const [m] = rows<{ role: string }>(await db.execute(sql`SELECT role FROM partner_members WHERE partner_id = ${partnerId} AND user_id = ${userId}`));
  return m?.role ?? null;
}

/** Partner panel guard: a member of this partner (or a NeuraTalk super admin). `owner` for money and settings. */
function requirePartner(level: "member" | "owner") {
  return async (req: Request, res: Response, next: NextFunction) => {
    const partnerId = Number(req.params.partnerId);
    if (!Number.isSafeInteger(partnerId) || partnerId <= 0) return res.status(400).json({ success: false, error: "Invalid id." });
    if (req.user?.role === "super_admin") return next();
    const role = await membership(req.user!.id, partnerId);
    if (!role) return res.status(403).json({ success: false, error: "You are not part of this partner." });
    if (level === "owner" && role !== "owner") return res.status(403).json({ success: false, error: "Only the partner owner can do this." });
    // A partner NeuraTalk paused can look, but not move money or add businesses.
    if (req.method !== "GET") {
      const [p] = rows<{ status: string; pause_reason: string | null }>(await db.execute(sql`SELECT status, pause_reason FROM partners WHERE id = ${partnerId}`));
      if (p?.status !== "active") {
        return res.status(403).json({ success: false, code: "PARTNER_PAUSED", error: `NeuraTalk paused this partner account.${p?.pause_reason ? " Reason: " + p.pause_reason.replace(/[.\s]+$/, "") + "." : ""} Contact support@mindwhile.com.` });
      }
    }
    next();
  };
}

/** The business must belong to the partner in the URL; anything else looks like "not found". */
async function ownsBusiness(partnerId: number, businessId: number): Promise<boolean> {
  const found = rows<{ business_id: number }>(await db.execute(sql`
    SELECT business_id FROM partner_businesses WHERE partner_id = ${partnerId} AND business_id = ${businessId}`));
  return found.length > 0;
}

const validId = (v: unknown) => Number.isSafeInteger(Number(v)) && Number(v) > 0;
const rs = (p: number) => `₹${(p / 100).toFixed(2)}`;

// Partner wallet movements always happen inside a transaction with the matching ledger line.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function moveWallet(tx: Tx, partnerId: number, deltaPaise: number, entry: { kind: string; businessId?: number | null; reference?: string | null; note?: string | null; actor: number }) {
  const [p] = rows<{ wallet_paise: string }>(await tx.execute(sql`
    UPDATE partners SET wallet_paise = wallet_paise + ${deltaPaise}, updated_at = now()
    WHERE id = ${partnerId} AND wallet_paise + ${deltaPaise} >= 0 RETURNING wallet_paise`));
  if (!p) throw new PartnerError(402, "NOT_ENOUGH_PARTNER_CREDIT", "Not enough credit in your partner wallet. Top it up first.");
  await tx.execute(sql`
    INSERT INTO partner_ledger (partner_id, kind, amount_paise, balance_after_paise, business_id, reference, note, created_by)
    VALUES (${partnerId}, ${entry.kind}, ${deltaPaise}, ${Number(p.wallet_paise)}, ${entry.businessId ?? null}, ${entry.reference ?? null}, ${entry.note ?? null}, ${entry.actor})`);
  return Number(p.wallet_paise);
}

/** Business wallet change + ledger line, in the caller's transaction. */
async function moveBusinessWallet(tx: Tx, businessId: number, deltaPaise: number, description: string, actor: number) {
  await tx.execute(sql`
    INSERT INTO billing_accounts (organization_id, wallet_balance_paise)
    SELECT ${businessId}, 0 WHERE NOT EXISTS (SELECT 1 FROM billing_accounts WHERE organization_id = ${businessId})`);
  const [a] = rows<{ id: number; wallet_balance_paise: number }>(await tx.execute(sql`
    UPDATE billing_accounts SET wallet_balance_paise = wallet_balance_paise + ${deltaPaise}, updated_at = now()
    WHERE organization_id = ${businessId} AND wallet_balance_paise - coalesce(locked_balance_paise, 0) + ${deltaPaise} >= 0
    RETURNING id, wallet_balance_paise`));
  if (!a) throw new PartnerError(409, "BUSINESS_BALANCE_TOO_LOW", "The business doesn't have that much unused credit.");
  await tx.execute(sql`
    INSERT INTO billing_ledger_entries (billing_account_id, organization_id, entry_type, direction, amount_paise, balance_after_paise, metadata, created_by)
    VALUES (${a.id}, ${businessId}, ${deltaPaise >= 0 ? "wallet_credit" : "wallet_debit"}, ${deltaPaise >= 0 ? "credit" : "debit"}, ${Math.abs(deltaPaise)},
      ${a.wallet_balance_paise}, ${JSON.stringify({ description })}::jsonb, ${actor})`);
  return a.wallet_balance_paise;
}

export class PartnerError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
function fail(res: Response, error: unknown, fallback: string) {
  if (error instanceof PartnerError) return res.status(error.status).json({ success: false, code: error.code, error: error.message });
  if (String((error as { code?: string })?.code) === "23505") return res.status(409).json({ success: false, error: "This is already in use (name, link or payment reference)." });
  logger.error("Partners", fallback, error instanceof Error ? error : new Error(String(error)));
  return res.status(500).json({ success: false, error: fallback });
}

const paymentRefSchema = z.string().trim().min(6, "Enter the UTR / transaction reference of your payment").max(40).regex(/^[A-Za-z0-9\-_/ ]+$/, "Use only letters and numbers from the payment reference");

/** A payment reference may be used once across business and partner payments. */
async function referenceInUse(ref: string): Promise<boolean> {
  const r = rows<{ n: number }>(await db.execute(sql`
    SELECT (SELECT count(*) FROM business_recharge_requests WHERE lower(payment_reference) = lower(${ref}) AND status IN ('pending', 'approved'))
         + (SELECT count(*) FROM partner_topups WHERE lower(payment_reference) = lower(${ref}) AND status IN ('pending', 'approved')) AS n`));
  return Number(r[0]?.n ?? 0) > 0;
}
export { referenceInUse as paymentReferenceInUse };

/** Create a business owned by a phone number, under a partner. Same rules as the Business app sign-up. */
async function createBusinessForPartner(partnerId: number, input: { name: string; category?: string; city?: string; ownerPhone: string; ownerName?: string }, actor: number) {
  const phone = normalizePhoneForIndia(input.ownerPhone);
  if (!phone) throw new PartnerError(400, "BAD_PHONE", "Enter the owner's mobile number.");
  const [existing] = rows<{ id: number; role: string | null; organization_id: number | null }>(await db.execute(sql`
    SELECT id, role, organization_id FROM users WHERE phone = ${phone} OR phone = ${input.ownerPhone} LIMIT 1`));
  if (existing) {
    if (existing.organization_id) throw new PartnerError(409, "ALREADY_A_BUSINESS", "This number already runs a business on NeuraTalk.");
    if (!["consumer", "user", ""].includes(String(existing.role ?? ""))) throw new PartnerError(409, "NOT_ALLOWED", "This number can't own a business.");
    // A personal NeuraTalk (with chats or calls) stays personal, like WhatsApp Business.
    const [history] = rows<{ n: number }>(await db.execute(sql`
      SELECT (SELECT count(*) FROM personal_chat_threads WHERE participant_a_user_id = ${existing.id} OR participant_b_user_id = ${existing.id})
           + (SELECT count(*) FROM call_billing_records WHERE user_id = ${existing.id}) AS n`));
    if (Number(history?.n ?? 0) > 0) throw new PartnerError(409, "PERSONAL_NUMBER", "This number is someone's personal NeuraTalk. A business needs its own number.");
  }
  const slugBase = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "business";
  const settings = { [BUSINESS_MESSAGING_SETTINGS_KEY]: businessMessagingSettingsSchema.parse({}), partner: { partnerId, createdBy: actor, createdAt: new Date().toISOString() } };
  const { GRANTABLE_BUSINESS_PERMISSIONS } = await import("../../business-rbac-routes");
  const created = await db.transaction(async (tx) => {
    const [org] = rows<{ id: number; name: string; slug: string }>(await tx.execute(sql`
      INSERT INTO organizations (name, slug, industry, address_city, phone, plan, status, is_active, approved_at, settings)
      VALUES (${input.name}, ${`${slugBase}-${Date.now().toString(36)}`}, ${input.category ?? null}, ${input.city ?? null}, ${phone}, 'free', 'approved', true, now(),
        ${JSON.stringify(settings)}::jsonb)
      RETURNING id, name, slug`));
    let ownerId: number;
    if (existing) {
      await tx.execute(sql`UPDATE users SET role = 'company_admin', organization_id = ${org.id} WHERE id = ${existing.id}`);
      ownerId = existing.id;
    } else {
      const uname = `${(input.ownerName ?? "owner").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "owner"}_${Date.now().toString(36)}`;
      const [u] = rows<{ id: number }>(await tx.execute(sql`
        INSERT INTO users (username, phone, display_name, role, organization_id, is_active)
        VALUES (${uname}, ${phone}, ${input.ownerName ?? null}, 'company_admin', ${org.id}, true) RETURNING id`));
      ownerId = u.id;
    }
    await tx.execute(sql`
      INSERT INTO org_members (organization_id, user_id, member_role, permissions)
      VALUES (${org.id}, ${ownerId}, 'owner', ${JSON.stringify(GRANTABLE_BUSINESS_PERMISSIONS)}::jsonb)`);
    await tx.execute(sql`INSERT INTO partner_businesses (business_id, partner_id) VALUES (${org.id}, ${partnerId})`);
    return { ...org, ownerId };
  });
  try {
    const { ensureOrganizationBillingReady } = await import("../../b2b-routes");
    await ensureOrganizationBillingReady(created.id, actor, 0);
  } catch (error) {
    logger.warn("Partners", `billing setup for business ${created.id} deferred: ${String(error)}`);
  }
  await createAuditLog({ userId: actor, organizationId: created.id, action: AUDIT_ACTION.CREATE as never, entityType: "organization", entityId: created.id, newValue: { name: created.name, partnerId } });
  return created;
}

// ------------------------------------------------------------------ routes

const brandSchema = z.object({
  brandName: z.string().trim().min(2).max(60),
  logoUrl: z.string().trim().max(500).regex(/^$|^https:\/\/\S+$|^\/objects\/\S+$/, "Logo must be an https:// link").optional().default(""),
  primaryColor: z.string().trim().regex(/^$|^#[0-9a-fA-F]{6}$/, "Colour like #1a73e8").optional().default(""),
  supportEmail: z.string().trim().max(120).regex(/^$|^[^@\s]+@[^@\s]+\.[^@\s]+$/, "Enter a valid email").optional().default(""),
  supportPhone: z.string().trim().max(20).regex(/^$|^\+?[0-9 ]{8,16}$/, "Enter a valid phone").optional().default(""),
});
const paymentDetailsSchema = z.object({
  upiId: z.string().trim().max(60).regex(/^$|^[\w.\-]{2,}@[a-zA-Z]{2,}$/, "Enter a UPI ID like name@bank").default(""),
  payeeName: z.string().trim().max(80).default(""),
  bankName: z.string().trim().max(80).default(""),
  accountNumber: z.string().trim().max(30).regex(/^$|^\d{6,20}$/, "Account number: digits only").default(""),
  ifsc: z.string().trim().max(11).regex(/^$|^[A-Z]{4}0[A-Z0-9]{6}$/, "Enter a valid IFSC").default(""),
  note: z.string().trim().max(300).default(""),
});
const nullablePaise = z.number().int().min(0).max(10_000).nullable();

export function registerPartnerRoutes(app: Express): void {
  const member = [requireAuth, requirePartner("member")];
  const owner = [requireAuth, requirePartner("owner")];
  const admin = [requireAuth, requireRole("super_admin")];
  const base = "/api/partner/:partnerId";

  // Public: the partner's brand for its sign-in page (/p/:slug). Nothing private.
  app.get("/api/partners/brand/:slug", async (req: Request, res: Response) => {
    const [p] = rows<PartnerRow>(await db.execute(sql`SELECT * FROM partners WHERE slug = ${String(req.params.slug).toLowerCase()} AND status = 'active'`));
    if (!p) return res.status(404).json({ success: false, error: "Partner not found." });
    res.json({ success: true, brand: brandOf(p) });
  });

  // Which partners the signed-in person works for.
  app.get("/api/partner/mine", requireAuth, async (req: Request, res: Response) => {
    const list = rows<PartnerRow & { role: string }>(await db.execute(sql`
      SELECT p.*, m.role FROM partner_members m JOIN partners p ON p.id = m.partner_id WHERE m.user_id = ${req.user!.id} ORDER BY p.brand_name`));
    res.json({ success: true, partners: list.map((p) => ({ ...brandOf(p), role: p.role, status: p.status })) });
  });

  // Business side: who manages this business (shown as "Managed by …" with support contact).
  app.get("/api/business/:businessId/managed-by", requireAuth, async (req: Request, res: Response) => {
    const businessId = Number(req.params.businessId);
    if (!validId(businessId)) return res.status(400).json({ success: false, error: "Invalid id." });
    if (req.user!.role !== "super_admin" && req.user!.organizationId !== businessId) return res.status(403).json({ success: false, error: "Not your business." });
    const p = await partnerOfBusiness(businessId);
    res.json({ success: true, partner: p ? brandOf(p) : null });
  });

  // ---------------------------------------------------------- partner panel
  app.get(base, ...member, async (req: Request, res: Response) => {
    try {
      const partnerId = Number(req.params.partnerId);
      const [p] = rows<PartnerRow>(await db.execute(sql`SELECT * FROM partners WHERE id = ${partnerId}`));
      if (!p) return res.status(404).json({ success: false, error: "Partner not found." });
      const businesses = rows<Record<string, unknown>>(await db.execute(sql`
        SELECT o.id, o.name, o.status, o.phone, o.created_at,
          coalesce(a.wallet_balance_paise, 0) AS balance, coalesce(a.is_blocked, false) AS blocked, a.blocked_reason,
          (SELECT coalesce(sum(u.amount_paise), 0) FROM business_message_usage_daily u WHERE u.business_id = o.id AND u.day > (now() AT TIME ZONE 'Asia/Kolkata')::date - 30) AS spent30,
          (SELECT coalesce(sum(u.messages), 0) FROM business_message_usage_daily u WHERE u.business_id = o.id AND u.day > (now() AT TIME ZONE 'Asia/Kolkata')::date - 30) AS messages30,
          (SELECT pl.name FROM subscriptions s JOIN billing_plans pl ON pl.id = s.plan_id WHERE s.organization_id = o.id AND s.status = 'active' ORDER BY s.created_at DESC LIMIT 1) AS plan_name,
          (SELECT s.end_date FROM subscriptions s WHERE s.organization_id = o.id AND s.status = 'active' ORDER BY s.created_at DESC LIMIT 1) AS plan_ends
        FROM partner_businesses pb JOIN organizations o ON o.id = pb.business_id
        LEFT JOIN billing_accounts a ON a.organization_id = o.id
        WHERE pb.partner_id = ${partnerId} ORDER BY o.name`));
      const pending = rows<Record<string, unknown>>(await db.execute(sql`
        SELECT r.*, o.name AS business_name, (SELECT name FROM billing_plans WHERE id = r.plan_id) AS plan_name
        FROM business_recharge_requests r JOIN organizations o ON o.id = r.business_id
        WHERE r.partner_id = ${partnerId} AND r.status = 'pending' ORDER BY r.created_at`));
      const ledger = rows<Record<string, unknown>>(await db.execute(sql`
        SELECT l.*, o.name AS business_name FROM partner_ledger l LEFT JOIN organizations o ON o.id = l.business_id
        WHERE l.partner_id = ${partnerId} ORDER BY l.created_at DESC LIMIT 50`));
      const topups = rows<Record<string, unknown>>(await db.execute(sql`
        SELECT * FROM partner_topups WHERE partner_id = ${partnerId} ORDER BY created_at DESC LIMIT 20`));
      const members = rows<{ user_id: number; role: string; phone: string | null; display_name: string | null }>(await db.execute(sql`
        SELECT m.user_id, m.role, u.phone, u.display_name FROM partner_members m JOIN users u ON u.id = m.user_id WHERE m.partner_id = ${partnerId} ORDER BY m.role DESC, u.id`));
      const { getMessagePrices } = await import("../messaging/pricing");
      const std = await getMessagePrices();
      const { getNeuraTalkPaymentDetails } = await import("../billing/message-credits");
      const plans = rows<{ id: number; name: string; price_in_paise: number; included_minutes: number; duration_days: number }>(await db.execute(sql`
        SELECT id, name, price_in_paise, included_minutes, duration_days FROM billing_plans WHERE plan_type = 'b2b' AND is_enabled AND price_in_paise > 0 ORDER BY display_order, price_in_paise`));
      res.json({
        success: true,
        partner: presentPartner(p),
        role: req.user!.role === "super_admin" ? "owner" : await membership(req.user!.id, partnerId),
        wholesaleRates: {
          marketingPaise: p.marketing_paise ?? std.marketingPaise, utilityPaise: p.utility_paise ?? std.utilityPaise, otpPaise: p.otp_paise ?? std.otpPaise,
        },
        plans: plans.map((x) => ({ id: x.id, name: x.name, pricePaise: x.price_in_paise, includedMinutes: x.included_minutes, durationDays: x.duration_days })),
        neuratalkPayment: await getNeuraTalkPaymentDetails(),
        minTopupPaise: MIN_PARTNER_TOPUP_PAISE,
        businesses: businesses.map((b) => ({
          id: b.id, name: b.name, status: b.status, phone: b.phone, createdAt: b.created_at, balancePaise: Number(b.balance),
          pausedByPartner: Boolean(b.blocked) && String(b.blocked_reason ?? "").startsWith(PARTNER_PAUSE_PREFIX),
          blocked: Boolean(b.blocked), spent30Paise: Number(b.spent30), messages30: Number(b.messages30), planName: b.plan_name, planEndsAt: b.plan_ends,
        })),
        pendingPayments: pending.map((r) => ({ id: r.id, businessId: r.business_id, businessName: r.business_name, kind: r.kind, planName: r.plan_name, pricePaise: r.price_paise, creditPaise: r.credit_paise, method: r.method, paymentReference: r.payment_reference, createdAt: r.created_at })),
        ledger: ledger.map((l) => ({ id: Number(l.id), kind: l.kind, amountPaise: Number(l.amount_paise), balanceAfterPaise: Number(l.balance_after_paise), businessId: l.business_id, businessName: l.business_name, reference: l.reference, note: l.note, createdAt: l.created_at })),
        topups: topups.map((t) => ({ id: t.id, amountPaise: Number(t.amount_paise), creditPaise: Number(t.credit_paise), method: t.method, paymentReference: t.payment_reference, status: t.status, decisionNote: t.decision_note, createdAt: t.created_at })),
        members: members.map((m) => ({ userId: m.user_id, role: m.role, phone: m.phone, name: m.display_name })),
      });
    } catch (error) { return fail(res, error, "Couldn't load the partner panel."); }
  });

  app.patch(`${base}/settings`, ...owner, async (req: Request, res: Response) => {
    const b = brandSchema.safeParse(req.body?.brand ?? {});
    const pay = paymentDetailsSchema.safeParse({ ...(req.body?.paymentDetails ?? {}), ifsc: String(req.body?.paymentDetails?.ifsc ?? "").toUpperCase() });
    if (!b.success) return res.status(400).json({ success: false, error: b.error.issues[0]?.message ?? "Check the brand." });
    if (!pay.success) return res.status(400).json({ success: false, error: pay.error.issues[0]?.message ?? "Check the payment details." });
    const d = b.data;
    const [p] = rows<PartnerRow>(await db.execute(sql`
      UPDATE partners SET brand_name = ${d.brandName}, logo_url = ${d.logoUrl || null}, primary_color = ${d.primaryColor || null},
        support_email = ${d.supportEmail || null}, support_phone = ${d.supportPhone || null},
        payment_details = ${JSON.stringify(pay.data)}::jsonb, updated_at = now()
      WHERE id = ${Number(req.params.partnerId)} RETURNING *`));
    await createAuditLog({ userId: req.user!.id, action: AUDIT_ACTION.SETTINGS_CHANGE as never, entityType: "partner", entityId: p.id, newValue: { brandName: d.brandName, upiId: pay.data.upiId } });
    res.json({ success: true, partner: presentPartner(p) });
  });

  app.post(`${base}/businesses`, ...member, async (req: Request, res: Response) => {
    const parsed = z.object({
      name: z.string().trim().min(2, "Business name is too short").max(80),
      category: z.string().trim().max(60).optional(),
      city: z.string().trim().max(60).optional(),
      ownerPhone: z.string().trim().min(8).max(20),
      ownerName: z.string().trim().max(80).optional(),
    }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? "Check the details." });
    const partnerId = Number(req.params.partnerId);
    const [p] = rows<{ status: string }>(await db.execute(sql`SELECT status FROM partners WHERE id = ${partnerId}`));
    if (p?.status !== "active") return res.status(403).json({ success: false, error: "This partner account is paused by NeuraTalk." });
    try {
      const created = await createBusinessForPartner(partnerId, parsed.data, req.user!.id);
      res.status(201).json({ success: true, business: { id: created.id, name: created.name, slug: created.slug } });
    } catch (error) { return fail(res, error, "Couldn't create the business."); }
  });

  // Give credit to a business (from the partner wallet), or take unused credit back.
  app.post(`${base}/businesses/:businessId/transfer`, ...owner, async (req: Request, res: Response) => {
    const partnerId = Number(req.params.partnerId), businessId = Number(req.params.businessId);
    const parsed = z.object({ amountPaise: z.number().int().min(100).max(100_000_000), direction: z.enum(["to_business", "from_business"]), note: z.string().trim().max(200).optional() }).safeParse(req.body ?? {});
    if (!validId(businessId) || !parsed.success) return res.status(400).json({ success: false, error: "Enter an amount of at least ₹1." });
    if (!(await ownsBusiness(partnerId, businessId))) return res.status(404).json({ success: false, error: "Business not found." });
    const { amountPaise, direction, note } = parsed.data;
    try {
      const out = await db.transaction(async (tx) => {
        if (direction === "to_business") {
          const wallet = await moveWallet(tx, partnerId, -amountPaise, { kind: "to_business", businessId, note, actor: req.user!.id });
          const bal = await moveBusinessWallet(tx, businessId, amountPaise, `Credit from partner #${partnerId}${note ? `: ${note}` : ""}`, req.user!.id);
          return { partnerWalletPaise: wallet, businessBalancePaise: bal };
        }
        const bal = await moveBusinessWallet(tx, businessId, -amountPaise, `Unused credit returned to partner #${partnerId}${note ? `: ${note}` : ""}`, req.user!.id);
        const wallet = await moveWallet(tx, partnerId, amountPaise, { kind: "from_business", businessId, note, actor: req.user!.id });
        return { partnerWalletPaise: wallet, businessBalancePaise: bal };
      });
      res.json({ success: true, ...out });
    } catch (error) { return fail(res, error, "Couldn't move the credit."); }
  });

  // Start a plan for a business, paid from the partner wallet.
  app.post(`${base}/businesses/:businessId/plan`, ...owner, async (req: Request, res: Response) => {
    const partnerId = Number(req.params.partnerId), businessId = Number(req.params.businessId);
    const planId = Number(req.body?.planId);
    if (!validId(businessId) || !validId(planId)) return res.status(400).json({ success: false, error: "Choose a plan." });
    if (!(await ownsBusiness(partnerId, businessId))) return res.status(404).json({ success: false, error: "Business not found." });
    try {
      const result = await givePlanFromPartner(partnerId, businessId, planId, req.user!.id, `PARTNER-${partnerId}-${Date.now()}`);
      res.json({ success: true, ...result });
    } catch (error) { return fail(res, error, "Couldn't start the plan."); }
  });

  // Pause / resume a business (stops all paid sending and calls while paused).
  app.post(`${base}/businesses/:businessId/pause`, ...owner, async (req: Request, res: Response) => {
    const partnerId = Number(req.params.partnerId), businessId = Number(req.params.businessId);
    const paused = req.body?.paused === true;
    const reason = String(req.body?.reason ?? "").trim().slice(0, 200);
    if (!validId(businessId)) return res.status(400).json({ success: false, error: "Invalid id." });
    if (paused && reason.length < 3) return res.status(400).json({ success: false, error: "Write the reason (the business sees it)." });
    if (!(await ownsBusiness(partnerId, businessId))) return res.status(404).json({ success: false, error: "Business not found." });
    if (paused) {
      // Never overwrite a block NeuraTalk set for another reason.
      const done = rows<{ id: number }>(await db.execute(sql`
        UPDATE billing_accounts SET is_blocked = true, blocked_reason = ${`${PARTNER_PAUSE_PREFIX}: ${reason}`}, blocked_at = now(), updated_at = now()
        WHERE organization_id = ${businessId} AND (NOT is_blocked OR blocked_reason LIKE ${PARTNER_PAUSE_PREFIX + "%"}) RETURNING id`));
      if (!done.length) return res.status(409).json({ success: false, error: "NeuraTalk has paused this business; only NeuraTalk can change it." });
    } else {
      await db.execute(sql`
        UPDATE billing_accounts SET is_blocked = false, blocked_reason = NULL, blocked_at = NULL, updated_at = now()
        WHERE organization_id = ${businessId} AND blocked_reason LIKE ${PARTNER_PAUSE_PREFIX + "%"}`);
    }
    await createAuditLog({ userId: req.user!.id, organizationId: businessId, action: (paused ? AUDIT_ACTION.SUSPEND : AUDIT_ACTION.UPDATE) as never, entityType: "partner_business", entityId: businessId, newValue: { partnerId, paused, reason } });
    res.json({ success: true, paused });
  });

  // Business payments to this partner (the partner checks its own bank, then confirms).
  app.post(`${base}/payments/:requestId/approve`, ...owner, async (req: Request, res: Response) => {
    const partnerId = Number(req.params.partnerId), requestId = Number(req.params.requestId);
    if (!validId(requestId)) return res.status(400).json({ success: false, error: "Invalid id." });
    const [r] = rows<{ id: number; business_id: number; kind: string; plan_id: number | null; credit_paise: number; price_paise: number; payment_reference: string }>(await db.execute(sql`
      UPDATE business_recharge_requests SET status = 'approved', decided_by = ${req.user!.id}, decided_at = now()
      WHERE id = ${requestId} AND partner_id = ${partnerId} AND status = 'pending' RETURNING *`));
    if (!r) return res.status(409).json({ success: false, error: "This payment was already decided, or it isn't yours." });
    try {
      if (r.kind === "plan" && r.plan_id) {
        const result = await givePlanFromPartner(partnerId, r.business_id, r.plan_id, req.user!.id, r.payment_reference);
        return res.json({ success: true, ...result });
      }
      const out = await db.transaction(async (tx) => {
        const wallet = await moveWallet(tx, partnerId, -r.credit_paise, { kind: "business_payment", businessId: r.business_id, reference: r.payment_reference, actor: req.user!.id });
        const bal = await moveBusinessWallet(tx, r.business_id, r.credit_paise, `Credit bought from partner #${partnerId}: payment ${r.payment_reference}`, req.user!.id);
        return { partnerWalletPaise: wallet, businessBalancePaise: bal };
      });
      res.json({ success: true, ...out });
    } catch (error) {
      await db.execute(sql`UPDATE business_recharge_requests SET status = 'pending', decided_by = NULL, decided_at = NULL WHERE id = ${r.id}`);
      return fail(res, error, "Couldn't confirm the payment. Nothing was changed.");
    }
  });

  app.post(`${base}/payments/:requestId/reject`, ...owner, async (req: Request, res: Response) => {
    const reason = String(req.body?.reason ?? "").trim().slice(0, 300);
    if (reason.length < 5) return res.status(400).json({ success: false, error: "Write the reason (the business sees it)." });
    const done = rows<{ id: number }>(await db.execute(sql`
      UPDATE business_recharge_requests SET status = 'rejected', decided_by = ${req.user!.id}, decided_at = now(), decision_note = ${reason}
      WHERE id = ${Number(req.params.requestId)} AND partner_id = ${Number(req.params.partnerId)} AND status = 'pending' RETURNING id`));
    if (!done.length) return res.status(409).json({ success: false, error: "This payment was already decided, or it isn't yours." });
    res.json({ success: true });
  });

  // Partner buys wholesale credit from NeuraTalk.
  app.post(`${base}/topups`, ...owner, async (req: Request, res: Response) => {
    const parsed = z.object({
      amountPaise: z.number().int().min(MIN_PARTNER_TOPUP_PAISE, `At least ${rs(MIN_PARTNER_TOPUP_PAISE)}`).max(1_000_000_000),
      method: z.enum(["upi", "bank_transfer", "cheque", "cash_deposit"]),
      paymentReference: paymentRefSchema,
    }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? "Check the details." });
    const partnerId = Number(req.params.partnerId);
    const ref = parsed.data.paymentReference.toUpperCase();
    if (await referenceInUse(ref)) return res.status(409).json({ success: false, error: "This payment reference was already used." });
    const [p] = rows<{ bonus_percent: number }>(await db.execute(sql`SELECT bonus_percent FROM partners WHERE id = ${partnerId}`));
    const credit = Math.floor(parsed.data.amountPaise * (100 + (p?.bonus_percent ?? 0)) / 100);
    try {
      const [t] = rows<Record<string, unknown>>(await db.execute(sql`
        INSERT INTO partner_topups (partner_id, amount_paise, credit_paise, method, payment_reference, requested_by)
        VALUES (${partnerId}, ${parsed.data.amountPaise}, ${credit}, ${parsed.data.method}, ${ref}, ${req.user!.id}) RETURNING *`));
      res.status(201).json({ success: true, topup: { id: t.id, amountPaise: Number(t.amount_paise), creditPaise: Number(t.credit_paise), status: t.status } });
    } catch (error) { return fail(res, error, "Couldn't send the payment."); }
  });

  app.post(`${base}/members`, ...owner, async (req: Request, res: Response) => {
    const phone = normalizePhoneForIndia(String(req.body?.phone ?? ""));
    const role = req.body?.role === "owner" ? "owner" : "staff";
    if (!phone) return res.status(400).json({ success: false, error: "Enter a mobile number." });
    const [u] = rows<{ id: number }>(await db.execute(sql`SELECT id FROM users WHERE phone = ${phone} LIMIT 1`));
    if (!u) return res.status(404).json({ success: false, error: "Ask them to sign in to NeuraTalk once with this number, then add them." });
    await db.execute(sql`INSERT INTO partner_members (partner_id, user_id, role) VALUES (${Number(req.params.partnerId)}, ${u.id}, ${role})
      ON CONFLICT (partner_id, user_id) DO UPDATE SET role = EXCLUDED.role`);
    res.status(201).json({ success: true });
  });

  app.delete(`${base}/members/:userId`, ...owner, async (req: Request, res: Response) => {
    const userId = Number(req.params.userId);
    if (userId === req.user!.id) return res.status(400).json({ success: false, error: "You can't remove yourself." });
    await db.execute(sql`DELETE FROM partner_members WHERE partner_id = ${Number(req.params.partnerId)} AND user_id = ${userId}`);
    res.json({ success: true });
  });

  // ---------------------------------------------------------- super admin
  app.get("/api/admin/partners", ...admin, async (_req: Request, res: Response) => {
    const list = rows<PartnerRow & { businesses: number; spent30: number }>(await db.execute(sql`
      SELECT p.*, (SELECT count(*)::int FROM partner_businesses b WHERE b.partner_id = p.id) AS businesses,
        (SELECT coalesce(sum(u.amount_paise), 0)::bigint FROM business_message_usage_daily u JOIN partner_businesses b ON b.business_id = u.business_id
          WHERE b.partner_id = p.id AND u.day > (now() AT TIME ZONE 'Asia/Kolkata')::date - 30) AS spent30
      FROM partners p ORDER BY p.created_at DESC`));
    const topups = rows<Record<string, unknown>>(await db.execute(sql`
      SELECT t.*, p.brand_name FROM partner_topups t JOIN partners p ON p.id = t.partner_id WHERE t.status = 'pending' ORDER BY t.created_at`));
    res.json({
      success: true,
      partners: list.map((p) => ({ ...presentPartner(p), businesses: p.businesses, spent30Paise: Number(p.spent30) })),
      pendingTopups: topups.map((t) => ({ id: t.id, partnerId: t.partner_id, brandName: t.brand_name, amountPaise: Number(t.amount_paise), creditPaise: Number(t.credit_paise), method: t.method, paymentReference: t.payment_reference, createdAt: t.created_at })),
    });
  });

  const partnerCreateSchema = z.object({
    name: z.string().trim().min(2).max(80),
    brandName: z.string().trim().min(2).max(60),
    slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{2,40}$/, "Link name: letters, numbers and - (3–40)"),
    ownerPhone: z.string().trim().min(8).max(20),
    bonusPercent: z.number().int().min(0).max(50).default(0),
    marketingPaise: nullablePaise.default(null), utilityPaise: nullablePaise.default(null), otpPaise: nullablePaise.default(null),
  });
  app.post("/api/admin/partners", ...admin, async (req: Request, res: Response) => {
    const parsed = partnerCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? "Check the details." });
    const d = parsed.data;
    const phone = normalizePhoneForIndia(d.ownerPhone);
    if (!phone) return res.status(400).json({ success: false, error: "Enter the owner's mobile number." });
    const [u] = rows<{ id: number; organization_id: number | null }>(await db.execute(sql`SELECT id, organization_id FROM users WHERE phone = ${phone} LIMIT 1`));
    if (!u) return res.status(404).json({ success: false, error: "Ask the partner owner to sign in to NeuraTalk once with this number first." });
    if (u.organization_id) return res.status(409).json({ success: false, error: "This number runs a business. A partner owner needs a separate number." });
    try {
      const p = await db.transaction(async (tx) => {
        const [created] = rows<PartnerRow>(await tx.execute(sql`
          INSERT INTO partners (name, brand_name, slug, bonus_percent, marketing_paise, utility_paise, otp_paise, created_by)
          VALUES (${d.name}, ${d.brandName}, ${d.slug}, ${d.bonusPercent}, ${d.marketingPaise}, ${d.utilityPaise}, ${d.otpPaise}, ${req.user!.id}) RETURNING *`));
        await tx.execute(sql`INSERT INTO partner_members (partner_id, user_id, role) VALUES (${created.id}, ${u.id}, 'owner')`);
        return created;
      });
      await createAuditLog({ userId: req.user!.id, action: AUDIT_ACTION.CREATE as never, entityType: "partner", entityId: p.id, newValue: { name: d.name, slug: d.slug, bonusPercent: d.bonusPercent } });
      res.status(201).json({ success: true, partner: presentPartner(p) });
    } catch (error) { return fail(res, error, "Couldn't create the partner."); }
  });

  app.patch("/api/admin/partners/:partnerId", ...admin, async (req: Request, res: Response) => {
    const parsed = z.object({
      status: z.enum(["active", "paused"]).optional(), pauseReason: z.string().trim().max(300).optional(),
      bonusPercent: z.number().int().min(0).max(50).optional(),
      marketingPaise: nullablePaise.optional(), utilityPaise: nullablePaise.optional(), otpPaise: nullablePaise.optional(),
    }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ success: false, error: "Check the details." });
    const d = parsed.data;
    if (d.status === "paused" && (d.pauseReason ?? "").length < 5) return res.status(400).json({ success: false, error: "Write the reason (the partner sees it)." });
    const id = Number(req.params.partnerId);
    const [cur] = rows<PartnerRow>(await db.execute(sql`SELECT * FROM partners WHERE id = ${id}`));
    if (!cur) return res.status(404).json({ success: false, error: "Partner not found." });
    const pick = <T>(v: T | undefined, old: T) => (v === undefined ? old : v);
    const [p] = rows<PartnerRow>(await db.execute(sql`
      UPDATE partners SET status = ${pick(d.status, cur.status)}, pause_reason = ${pick(d.status, cur.status) === "paused" ? pick(d.pauseReason, cur.pause_reason) : null},
        bonus_percent = ${pick(d.bonusPercent, cur.bonus_percent)}, marketing_paise = ${pick(d.marketingPaise, cur.marketing_paise)},
        utility_paise = ${pick(d.utilityPaise, cur.utility_paise)}, otp_paise = ${pick(d.otpPaise, cur.otp_paise)}, updated_at = now()
      WHERE id = ${id} RETURNING *`));
    await createAuditLog({ userId: req.user!.id, action: (d.status === "paused" ? AUDIT_ACTION.SUSPEND : AUDIT_ACTION.UPDATE) as never, entityType: "partner", entityId: id, newValue: d });
    res.json({ success: true, partner: presentPartner(p) });
  });

  // Move an existing business under a partner, or back to NeuraTalk directly.
  app.post("/api/admin/partners/:partnerId/businesses", ...admin, async (req: Request, res: Response) => {
    const businessId = Number(req.body?.businessId);
    if (!validId(businessId)) return res.status(400).json({ success: false, error: "Enter the company id." });
    try {
      await db.execute(sql`INSERT INTO partner_businesses (business_id, partner_id) VALUES (${businessId}, ${Number(req.params.partnerId)})`);
      res.status(201).json({ success: true });
    } catch (error) { return fail(res, error, "Couldn't add the business."); }
  });
  app.delete("/api/admin/partners/:partnerId/businesses/:businessId", ...admin, async (req: Request, res: Response) => {
    await db.execute(sql`DELETE FROM partner_businesses WHERE partner_id = ${Number(req.params.partnerId)} AND business_id = ${Number(req.params.businessId)}`);
    res.json({ success: true });
  });

  app.post("/api/admin/partners/topups/:topupId/approve", ...admin, async (req: Request, res: Response) => {
    const [t] = rows<{ id: number; partner_id: number; credit_paise: string; amount_paise: string; payment_reference: string }>(await db.execute(sql`
      UPDATE partner_topups SET status = 'approved', decided_by = ${req.user!.id}, decided_at = now()
      WHERE id = ${Number(req.params.topupId)} AND status = 'pending' RETURNING *`));
    if (!t) return res.status(409).json({ success: false, error: "This payment was already decided." });
    try {
      const wallet = await db.transaction((tx) => moveWallet(tx, t.partner_id, Number(t.credit_paise), { kind: "topup", reference: t.payment_reference, note: `Paid ${rs(Number(t.amount_paise))}`, actor: req.user!.id }));
      await createAuditLog({ userId: req.user!.id, action: AUDIT_ACTION.UPDATE as never, entityType: "partner_topup", entityId: t.id, newValue: { partnerId: t.partner_id, creditPaise: Number(t.credit_paise), reference: t.payment_reference } });
      res.json({ success: true, partnerWalletPaise: wallet });
    } catch (error) {
      await db.execute(sql`UPDATE partner_topups SET status = 'pending', decided_by = NULL, decided_at = NULL WHERE id = ${t.id}`);
      return fail(res, error, "Couldn't add the credit. Nothing was changed.");
    }
  });
  app.post("/api/admin/partners/topups/:topupId/reject", ...admin, async (req: Request, res: Response) => {
    const reason = String(req.body?.reason ?? "").trim().slice(0, 300);
    if (reason.length < 5) return res.status(400).json({ success: false, error: "Write the reason (the partner sees it)." });
    const done = rows<{ id: number }>(await db.execute(sql`
      UPDATE partner_topups SET status = 'rejected', decided_by = ${req.user!.id}, decided_at = now(), decision_note = ${reason}
      WHERE id = ${Number(req.params.topupId)} AND status = 'pending' RETURNING id`));
    if (!done.length) return res.status(409).json({ success: false, error: "This payment was already decided." });
    res.json({ success: true });
  });
}

/** Plan for a partner's business, paid from the partner wallet at NeuraTalk's plan price. */
async function givePlanFromPartner(partnerId: number, businessId: number, planId: number, actor: number, reference: string) {
  const [plan] = rows<{ id: number; name: string; price_in_paise: number }>(await db.execute(sql`
    SELECT id, name, price_in_paise FROM billing_plans WHERE id = ${planId} AND plan_type = 'b2b' AND is_enabled AND price_in_paise > 0`));
  if (!plan) throw new PartnerError(400, "PLAN_NOT_OFFERED", "That plan is not offered.");
  const wallet = await db.transaction((tx) => moveWallet(tx, partnerId, -plan.price_in_paise, { kind: "plan_for_business", businessId, reference, note: plan.name, actor }));
  try {
    const { activatePlanForBusiness } = await import("../billing/message-credits");
    const started = await activatePlanForBusiness(businessId, plan.id, actor, reference);
    return { partnerWalletPaise: wallet, plan: started };
  } catch (error) {
    // Give the money back if the plan couldn't start.
    await db.transaction((tx) => moveWallet(tx, partnerId, plan.price_in_paise, { kind: "refund", businessId, reference, note: `Plan ${plan.name} not started`, actor }));
    throw error;
  }
}
