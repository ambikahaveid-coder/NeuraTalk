/**
 * Selling business message credits (like WhatsApp Business / reseller panels), pay first:
 *
 *   NeuraTalk (super admin)                     Business (company admin)
 *   - credit packs (pay ₹1,000 → ₹1,050)        - sees balance, its rates, packs
 *   - UPI / bank details to pay to              - pays, then sends the UTR / reference
 *   - approves the payment → wallet credited    - sees request status and a spend statement
 *   - special rates per business, low-balance level
 *
 * Online payment is not switched on, so a person at NeuraTalk confirms each
 * payment against the bank statement before any credit is added. A payment
 * reference can be used once only. Every credit goes through
 * BillingEngine.adjustOrganizationBalance (ledger + audit log).
 */
import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { AUDIT_ACTION, billingAccounts, PERMISSIONS, platformSettings } from "@shared/schema";
import { requireAuth, requireCompanyAccess, requirePermission, requireRole } from "../../role-middleware";
import { BillingEngine } from "../../billing-engine";
import { createAuditLog } from "../../audit";
import { logger } from "../../observability";
import { getMessagePrices, getMessagePricesFor } from "../messaging/pricing";

const rows = <T>(r: unknown) => (r as { rows: T[] }).rows;
const INSTRUCTIONS_KEY = "business_payment_instructions";
export const DEFAULT_LOW_BALANCE_PAISE = 10_000; // ₹100
export const MIN_CUSTOM_RECHARGE_PAISE = 50_000; // ₹500
const MAX_PENDING_REQUESTS = 5;

export async function ensureMessageCreditTables(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "business_credit_packs" (
      "id" serial PRIMARY KEY NOT NULL,
      "name" text NOT NULL,
      "price_paise" integer NOT NULL,
      "credit_paise" integer NOT NULL,
      "is_active" boolean NOT NULL DEFAULT true,
      "display_order" integer NOT NULL DEFAULT 100,
      "created_by" integer,
      "created_at" timestamp DEFAULT now(),
      "updated_at" timestamp DEFAULT now()
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "business_recharge_requests" (
      "id" serial PRIMARY KEY NOT NULL,
      "business_id" integer NOT NULL,
      "pack_id" integer,
      "price_paise" integer NOT NULL,
      "credit_paise" integer NOT NULL,
      "method" text NOT NULL,
      "payment_reference" text NOT NULL,
      "note" text,
      "status" text NOT NULL DEFAULT 'pending',
      "requested_by" integer NOT NULL,
      "decided_by" integer,
      "decided_at" timestamp,
      "decision_note" text,
      "created_at" timestamp DEFAULT now()
    )`);
  // A payment reference (UTR) can pay for one request only, unless that request was rejected or cancelled.
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "business_recharge_requests_ref_once"
    ON "business_recharge_requests" (lower("payment_reference")) WHERE "status" IN ('pending', 'approved')`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "business_recharge_requests_business_idx" ON "business_recharge_requests" ("business_id", "created_at")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "business_recharge_requests_status_idx" ON "business_recharge_requests" ("status", "created_at")`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "business_message_rates" (
      "business_id" integer PRIMARY KEY NOT NULL,
      "marketing_paise" integer,
      "utility_paise" integer,
      "otp_paise" integer,
      "low_balance_paise" integer,
      "updated_by" integer,
      "updated_at" timestamp DEFAULT now()
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "business_message_usage_daily" (
      "business_id" integer NOT NULL,
      "day" date NOT NULL,
      "category" text NOT NULL,
      "messages" integer NOT NULL DEFAULT 0,
      "amount_paise" integer NOT NULL DEFAULT 0,
      PRIMARY KEY ("business_id", "day", "category")
    )`);
}

export type PaymentInstructions = { upiId: string; payeeName: string; bankName: string; accountNumber: string; ifsc: string; note: string };
const EMPTY_INSTRUCTIONS: PaymentInstructions = { upiId: "", payeeName: "", bankName: "", accountNumber: "", ifsc: "", note: "" };

async function getInstructions(): Promise<PaymentInstructions> {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, INSTRUCTIONS_KEY));
  if (!row) return EMPTY_INSTRUCTIONS;
  // jsonb may hold the object itself or (older writes) the object as JSON text.
  let v: unknown = row.value;
  for (let i = 0; i < 2 && typeof v === "string"; i++) {
    try { v = JSON.parse(v); } catch { return EMPTY_INSTRUCTIONS; }
  }
  if (!v || typeof v !== "object") return EMPTY_INSTRUCTIONS;
  const o = v as Record<string, unknown>;
  const s = (k: keyof PaymentInstructions) => (typeof o[k] === "string" ? (o[k] as string) : "");
  return { upiId: s("upiId"), payeeName: s("payeeName"), bankName: s("bankName"), accountNumber: s("accountNumber"), ifsc: s("ifsc"), note: s("note") };
}
const instructionsReady = (i: PaymentInstructions) => Boolean(i.upiId || (i.accountNumber && i.ifsc));

async function balanceOf(businessId: number): Promise<number> {
  const [a] = await db.select({ w: billingAccounts.walletBalancePaise }).from(billingAccounts).where(eq(billingAccounts.organizationId, businessId));
  return a?.w ?? 0;
}

async function lowBalanceLevel(businessId: number): Promise<number> {
  const [r] = rows<{ low_balance_paise: number | null }>(await db.execute(sql`SELECT low_balance_paise FROM business_message_rates WHERE business_id = ${businessId}`));
  return r?.low_balance_paise ?? DEFAULT_LOW_BALANCE_PAISE;
}

type PackRow = { id: number; name: string; price_paise: number; credit_paise: number; is_active: boolean; display_order: number };
const presentPack = (p: PackRow) => ({ id: p.id, name: p.name, pricePaise: p.price_paise, creditPaise: p.credit_paise, bonusPaise: Math.max(0, p.credit_paise - p.price_paise), isActive: p.is_active, displayOrder: p.display_order });

type RequestRow = { id: number; business_id: number; pack_id: number | null; price_paise: number; credit_paise: number; method: string; payment_reference: string; note: string | null; status: string; requested_by: number; decided_by: number | null; decided_at: Date | null; decision_note: string | null; created_at: Date; business_name?: string; requester?: string | null };
const presentRequest = (r: RequestRow) => ({
  id: r.id, businessId: r.business_id, businessName: r.business_name, packId: r.pack_id, pricePaise: r.price_paise, creditPaise: r.credit_paise,
  method: r.method, paymentReference: r.payment_reference, note: r.note, status: r.status, requestedBy: r.requester ?? r.requested_by,
  decidedAt: r.decided_at, decisionNote: r.decision_note, createdAt: r.created_at,
});

/** Balance, rates, packs, how to pay, requests and the last 30 days' spending — the company's credits page. */
export async function creditsOverview(businessId: number) {
  const [balancePaise, low, prices, instructions] = await Promise.all([balanceOf(businessId), lowBalanceLevel(businessId), getMessagePricesFor(businessId), getInstructions()]);
  const packs = rows<PackRow>(await db.execute(sql`SELECT * FROM business_credit_packs WHERE is_active ORDER BY display_order, price_paise`));
  const requests = rows<RequestRow>(await db.execute(sql`SELECT * FROM business_recharge_requests WHERE business_id = ${businessId} ORDER BY created_at DESC LIMIT 20`));
  const usage = rows<{ day: string; category: string; messages: number; amount_paise: number }>(await db.execute(sql`
    SELECT to_char(day, 'YYYY-MM-DD') AS day, category, messages, amount_paise FROM business_message_usage_daily
    WHERE business_id = ${businessId} AND day > (now() AT TIME ZONE 'Asia/Kolkata')::date - 30 ORDER BY day DESC, category`));
  const spent30 = usage.reduce((s, u) => s + Number(u.amount_paise), 0);
  const perDay = spent30 / 30;
  return {
    balancePaise,
    lowBalancePaise: low,
    isLow: balancePaise < low,
    // Rough days left at the last 30 days' pace; only shown when it's a useful number (under a year).
    daysLeft: perDay > 0 && balancePaise / perDay < 365 ? Math.floor(balancePaise / perDay) : null,
    rates: { marketingPaise: prices.marketingPaise, utilityPaise: prices.utilityPaise, otpPaise: prices.otpPaise, special: prices.special, freeReplies: true },
    packs: packs.map(presentPack),
    payment: { ready: instructionsReady(instructions), ...instructions },
    customAmount: { minPaise: MIN_CUSTOM_RECHARGE_PAISE },
    requests: requests.map(presentRequest),
    usage: usage.map((u) => ({ day: u.day, category: u.category, messages: Number(u.messages), amountPaise: Number(u.amount_paise) })),
    spent30dPaise: spent30,
  };
}

const requestSchema = z.object({
  packId: z.number().int().positive().optional(),
  amountPaise: z.number().int().min(MIN_CUSTOM_RECHARGE_PAISE).max(100_000_000).optional(),
  method: z.enum(["upi", "bank_transfer", "cheque", "cash_deposit"]),
  paymentReference: z.string().trim().min(6, "Enter the UTR / transaction reference of your payment").max(40).regex(/^[A-Za-z0-9\-_/ ]+$/, "Use only letters and numbers from the payment reference"),
  note: z.string().trim().max(300).optional(),
}).refine((v) => Boolean(v.packId) !== Boolean(v.amountPaise), { message: "Choose a pack or enter an amount" });

function validIds(req: Request, res: Response, next: NextFunction) {
  for (const key of ["businessId", "requestId", "packId", "orgId"]) {
    const v = req.params[key];
    if (v !== undefined && !(Number.isSafeInteger(Number(v)) && Number(v) > 0)) return res.status(400).json({ success: false, error: "Invalid id." });
  }
  next();
}

const csvCell = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const rupees = (p: number) => (p / 100).toFixed(2);

export function registerMessageCreditRoutes(app: Express): void {
  const base = "/api/business/:businessId/credits";
  const view = [requireAuth, validIds, requireCompanyAccess("businessId"), requirePermission(PERMISSIONS.MESSAGING_SEND)];
  const owner = [requireAuth, validIds, requireCompanyAccess("businessId"), requireRole("company_admin", "super_admin")];
  const admin = [requireAuth, validIds, requireRole("super_admin")];

  // ---------------------------------------------------------------- company
  app.get(base, ...view, async (req: Request, res: Response) => {
    res.json({ success: true, ...(await creditsOverview(Number(req.params.businessId))) });
  });

  app.post(`${base}/requests`, ...owner, async (req: Request, res: Response) => {
    const businessId = Number(req.params.businessId);
    const parsed = requestSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? "Check the details." });
    const d = parsed.data;
    let price = d.amountPaise ?? 0, credit = d.amountPaise ?? 0;
    if (d.packId) {
      const [p] = rows<PackRow>(await db.execute(sql`SELECT * FROM business_credit_packs WHERE id = ${d.packId} AND is_active`));
      if (!p) return res.status(400).json({ success: false, error: "That pack is no longer offered." });
      price = p.price_paise; credit = p.credit_paise;
    }
    const [{ n }] = rows<{ n: number }>(await db.execute(sql`SELECT count(*)::int AS n FROM business_recharge_requests WHERE business_id = ${businessId} AND status = 'pending'`));
    if (n >= MAX_PENDING_REQUESTS) return res.status(429).json({ success: false, error: "You already have payments waiting for confirmation. NeuraTalk will confirm them soon." });
    try {
      const [r] = rows<RequestRow>(await db.execute(sql`
        INSERT INTO business_recharge_requests (business_id, pack_id, price_paise, credit_paise, method, payment_reference, note, requested_by)
        VALUES (${businessId}, ${d.packId ?? null}, ${price}, ${credit}, ${d.method}, ${d.paymentReference.toUpperCase()}, ${d.note ?? null}, ${req.user!.id})
        RETURNING *`));
      res.status(201).json({ success: true, request: presentRequest(r) });
    } catch (error) {
      if (String((error as { code?: string })?.code) === "23505" || /business_recharge_requests_ref_once/.test(String(error))) {
        return res.status(409).json({ success: false, error: "This payment reference was already used. Check the UTR from your bank app." });
      }
      throw error;
    }
  });

  app.post(`${base}/requests/:requestId/cancel`, ...owner, async (req: Request, res: Response) => {
    const done = rows<{ id: number }>(await db.execute(sql`
      UPDATE business_recharge_requests SET status = 'cancelled', decided_at = now(), decided_by = ${req.user!.id}
      WHERE id = ${Number(req.params.requestId)} AND business_id = ${Number(req.params.businessId)} AND status = 'pending' RETURNING id`));
    if (!done.length) return res.status(404).json({ success: false, error: "No waiting payment with that id." });
    res.json({ success: true });
  });

  app.get(`${base}/statement.csv`, ...owner, async (req: Request, res: Response) => {
    const businessId = Number(req.params.businessId);
    const usage = rows<{ day: string; category: string; messages: number; amount_paise: number }>(await db.execute(sql`
      SELECT to_char(day, 'YYYY-MM-DD') AS day, category, messages, amount_paise FROM business_message_usage_daily
      WHERE business_id = ${businessId} AND day > (now() AT TIME ZONE 'Asia/Kolkata')::date - 90 ORDER BY day, category`));
    const credits = rows<RequestRow>(await db.execute(sql`
      SELECT * FROM business_recharge_requests WHERE business_id = ${businessId} AND status = 'approved'
        AND decided_at > now() - interval '90 days' ORDER BY decided_at`));
    const lines = [
      ["Date", "Type", "Messages", "Amount (Rs)", "Reference"].join(","),
      ...usage.map((u) => [u.day, `Messages: ${u.category}`, u.messages, `-${rupees(Number(u.amount_paise))}`, ""].map(csvCell).join(",")),
      ...credits.map((c) => [new Date(c.decided_at!).toISOString().slice(0, 10), "Credit added", "", rupees(c.credit_paise), c.payment_reference].map(csvCell).join(",")),
    ];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="neuratalk-statement-${businessId}.csv"`);
    res.send("﻿" + lines.join("\n"));
  });

  // ---------------------------------------------------------------- super admin
  app.get("/api/admin/message-credits", ...admin, async (_req: Request, res: Response) => {
    const pending = rows<RequestRow>(await db.execute(sql`
      SELECT r.*, o.name AS business_name, coalesce(u.display_name, u.phone, u.username) AS requester
      FROM business_recharge_requests r JOIN organizations o ON o.id = r.business_id LEFT JOIN users u ON u.id = r.requested_by
      WHERE r.status = 'pending' ORDER BY r.created_at`));
    const recent = rows<RequestRow>(await db.execute(sql`
      SELECT r.*, o.name AS business_name FROM business_recharge_requests r JOIN organizations o ON o.id = r.business_id
      WHERE r.status <> 'pending' ORDER BY r.decided_at DESC NULLS LAST LIMIT 30`));
    const packs = rows<PackRow>(await db.execute(sql`SELECT * FROM business_credit_packs ORDER BY display_order, price_paise`));
    const [totals] = rows<{ received: number; credited: number; spent: number }>(await db.execute(sql`
      SELECT
        (SELECT coalesce(sum(price_paise), 0)::bigint FROM business_recharge_requests WHERE status = 'approved' AND decided_at > now() - interval '30 days') AS received,
        (SELECT coalesce(sum(credit_paise), 0)::bigint FROM business_recharge_requests WHERE status = 'approved' AND decided_at > now() - interval '30 days') AS credited,
        (SELECT coalesce(sum(amount_paise), 0)::bigint FROM business_message_usage_daily WHERE day > (now() AT TIME ZONE 'Asia/Kolkata')::date - 30) AS spent`));
    const rates = rows<{ business_id: number; name: string; marketing_paise: number | null; utility_paise: number | null; otp_paise: number | null; low_balance_paise: number | null }>(await db.execute(sql`
      SELECT r.*, o.name FROM business_message_rates r JOIN organizations o ON o.id = r.business_id ORDER BY o.name`));
    const lowBalance = rows<{ id: number; name: string; balance: number; level: number }>(await db.execute(sql`
      SELECT o.id, o.name, a.wallet_balance_paise AS balance, coalesce(r.low_balance_paise, ${DEFAULT_LOW_BALANCE_PAISE}) AS level
      FROM billing_accounts a JOIN organizations o ON o.id = a.organization_id
      LEFT JOIN business_message_rates r ON r.business_id = o.id
      WHERE EXISTS (SELECT 1 FROM business_message_usage_daily u WHERE u.business_id = o.id AND u.day > (now() AT TIME ZONE 'Asia/Kolkata')::date - 30)
        AND a.wallet_balance_paise < coalesce(r.low_balance_paise, ${DEFAULT_LOW_BALANCE_PAISE})
      ORDER BY a.wallet_balance_paise LIMIT 50`));
    res.json({
      success: true,
      pending: pending.map(presentRequest),
      recent: recent.map(presentRequest),
      packs: packs.map(presentPack),
      payment: await getInstructions(),
      standardPrices: await getMessagePrices(),
      specialRates: rates.map((r) => ({ businessId: r.business_id, name: r.name, marketingPaise: r.marketing_paise, utilityPaise: r.utility_paise, otpPaise: r.otp_paise, lowBalancePaise: r.low_balance_paise })),
      last30d: { receivedPaise: Number(totals.received), creditedPaise: Number(totals.credited), spentPaise: Number(totals.spent) },
      lowBalance: lowBalance.map((l) => ({ businessId: l.id, name: l.name, balancePaise: Number(l.balance), levelPaise: Number(l.level) })),
    });
  });

  app.post("/api/admin/message-credits/requests/:requestId/approve", ...admin, async (req: Request, res: Response) => {
    const note = String(req.body?.note ?? "").trim().slice(0, 300) || null;
    // Claim first (pending → approved), so two admins clicking at once can't credit twice.
    const [r] = rows<RequestRow>(await db.execute(sql`
      UPDATE business_recharge_requests SET status = 'approved', decided_by = ${req.user!.id}, decided_at = now(), decision_note = ${note}
      WHERE id = ${Number(req.params.requestId)} AND status = 'pending' RETURNING *`));
    if (!r) return res.status(409).json({ success: false, error: "This request was already decided." });
    try {
      const account = await BillingEngine.adjustOrganizationBalance({
        organizationId: r.business_id, amountPaise: r.credit_paise, type: "wallet_credit", actorUserId: req.user!.id,
        description: `Message credits: payment ${r.payment_reference} (${r.method}), paid ${rupees(r.price_paise)}, credit ${rupees(r.credit_paise)}`,
      });
      res.json({ success: true, request: presentRequest(r), balancePaise: account.walletBalancePaise });
    } catch (error) {
      await db.execute(sql`UPDATE business_recharge_requests SET status = 'pending', decided_by = NULL, decided_at = NULL WHERE id = ${r.id}`);
      logger.error("MessageCredits", "credit failed", error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ success: false, error: "Couldn't add the credit. Nothing was changed; try again." });
    }
  });

  app.post("/api/admin/message-credits/requests/:requestId/reject", ...admin, async (req: Request, res: Response) => {
    const reason = String(req.body?.reason ?? "").trim().slice(0, 300);
    if (reason.length < 5) return res.status(400).json({ success: false, error: "Write the reason (the business sees it)." });
    const [r] = rows<RequestRow>(await db.execute(sql`
      UPDATE business_recharge_requests SET status = 'rejected', decided_by = ${req.user!.id}, decided_at = now(), decision_note = ${reason}
      WHERE id = ${Number(req.params.requestId)} AND status = 'pending' RETURNING *`));
    if (!r) return res.status(409).json({ success: false, error: "This request was already decided." });
    await createAuditLog({ userId: req.user!.id, organizationId: r.business_id, action: AUDIT_ACTION.UPDATE as never, entityType: "recharge_request", entityId: r.id, newValue: { status: "rejected", reason } });
    res.json({ success: true, request: presentRequest(r) });
  });

  const packSchema = z.object({
    name: z.string().trim().min(2).max(40),
    pricePaise: z.number().int().min(10_000).max(100_000_000),
    creditPaise: z.number().int().min(10_000).max(200_000_000),
    isActive: z.boolean().default(true),
    displayOrder: z.number().int().min(0).max(1000).default(100),
  }).refine((p) => p.creditPaise >= p.pricePaise, { message: "Credit can't be less than the price" })
    .refine((p) => p.creditPaise <= p.pricePaise * 2, { message: "Bonus can't be more than the price" });

  app.post("/api/admin/message-credits/packs", ...admin, async (req: Request, res: Response) => {
    const p = packSchema.safeParse(req.body ?? {});
    if (!p.success) return res.status(400).json({ success: false, error: p.error.issues[0]?.message ?? "Check the pack." });
    const [row] = rows<PackRow>(await db.execute(sql`
      INSERT INTO business_credit_packs (name, price_paise, credit_paise, is_active, display_order, created_by)
      VALUES (${p.data.name}, ${p.data.pricePaise}, ${p.data.creditPaise}, ${p.data.isActive}, ${p.data.displayOrder}, ${req.user!.id}) RETURNING *`));
    res.status(201).json({ success: true, pack: presentPack(row) });
  });

  app.put("/api/admin/message-credits/packs/:packId", ...admin, async (req: Request, res: Response) => {
    const p = packSchema.safeParse(req.body ?? {});
    if (!p.success) return res.status(400).json({ success: false, error: p.error.issues[0]?.message ?? "Check the pack." });
    const [row] = rows<PackRow>(await db.execute(sql`
      UPDATE business_credit_packs SET name = ${p.data.name}, price_paise = ${p.data.pricePaise}, credit_paise = ${p.data.creditPaise},
        is_active = ${p.data.isActive}, display_order = ${p.data.displayOrder}, updated_at = now()
      WHERE id = ${Number(req.params.packId)} RETURNING *`));
    if (!row) return res.status(404).json({ success: false, error: "Pack not found." });
    res.json({ success: true, pack: presentPack(row) });
  });

  const instructionsSchema = z.object({
    upiId: z.string().trim().max(60).regex(/^$|^[\w.\-]{2,}@[a-zA-Z]{2,}$/, "Enter a UPI ID like name@bank").default(""),
    payeeName: z.string().trim().max(80).default(""),
    bankName: z.string().trim().max(80).default(""),
    accountNumber: z.string().trim().max(30).regex(/^$|^\d{6,20}$/, "Account number: digits only").default(""),
    ifsc: z.string().trim().max(11).regex(/^$|^[A-Z]{4}0[A-Z0-9]{6}$/, "Enter a valid IFSC").default(""),
    note: z.string().trim().max(300).default(""),
  });
  app.put("/api/admin/message-credits/payment-details", ...admin, async (req: Request, res: Response) => {
    const p = instructionsSchema.safeParse({ ...(req.body ?? {}), ifsc: String(req.body?.ifsc ?? "").toUpperCase() });
    if (!p.success) return res.status(400).json({ success: false, error: p.error.issues[0]?.message ?? "Check the details." });
    const value = p.data; // stored as a jsonb object
    const [existing] = await db.select().from(platformSettings).where(eq(platformSettings.key, INSTRUCTIONS_KEY));
    if (existing) await db.update(platformSettings).set({ value, updatedBy: req.user!.id, updatedAt: new Date() }).where(eq(platformSettings.key, INSTRUCTIONS_KEY));
    else await db.insert(platformSettings).values({ key: INSTRUCTIONS_KEY, value, updatedBy: req.user!.id } as never);
    await createAuditLog({ userId: req.user!.id, action: AUDIT_ACTION.SETTINGS_CHANGE as never, entityType: "payment_details", newValue: { upiId: p.data.upiId, bankName: p.data.bankName, ifsc: p.data.ifsc } });
    res.json({ success: true, payment: p.data });
  });

  const nullablePaise = z.number().int().min(0).max(10_000).nullable();
  app.put("/api/admin/message-credits/rates/:orgId", ...admin, async (req: Request, res: Response) => {
    const p = z.object({ marketingPaise: nullablePaise, utilityPaise: nullablePaise, otpPaise: nullablePaise, lowBalancePaise: z.number().int().min(0).max(100_000_000).nullable() }).safeParse(req.body ?? {});
    if (!p.success) return res.status(400).json({ success: false, error: "Rates are in paise (0–10,000); leave empty for the standard price." });
    const orgId = Number(req.params.orgId);
    const found = rows<{ id: number }>(await db.execute(sql`SELECT id FROM organizations WHERE id = ${orgId}`));
    if (!found.length) return res.status(404).json({ success: false, error: "Company not found." });
    const d = p.data;
    if (d.marketingPaise === null && d.utilityPaise === null && d.otpPaise === null && d.lowBalancePaise === null) {
      // Everything back to standard: remove the special-rate row.
      await db.execute(sql`DELETE FROM business_message_rates WHERE business_id = ${orgId}`);
      await createAuditLog({ userId: req.user!.id, organizationId: orgId, action: AUDIT_ACTION.SETTINGS_CHANGE as never, entityType: "message_rates", entityId: orgId, newValue: { standard: true } });
      return res.json({ success: true, prices: await getMessagePricesFor(orgId) });
    }
    await db.execute(sql`
      INSERT INTO business_message_rates (business_id, marketing_paise, utility_paise, otp_paise, low_balance_paise, updated_by, updated_at)
      VALUES (${orgId}, ${d.marketingPaise}, ${d.utilityPaise}, ${d.otpPaise}, ${d.lowBalancePaise}, ${req.user!.id}, now())
      ON CONFLICT (business_id) DO UPDATE SET marketing_paise = EXCLUDED.marketing_paise, utility_paise = EXCLUDED.utility_paise,
        otp_paise = EXCLUDED.otp_paise, low_balance_paise = EXCLUDED.low_balance_paise, updated_by = EXCLUDED.updated_by, updated_at = now()`);
    await createAuditLog({ userId: req.user!.id, organizationId: orgId, action: AUDIT_ACTION.SETTINGS_CHANGE as never, entityType: "message_rates", entityId: orgId, newValue: d });
    res.json({ success: true, prices: await getMessagePricesFor(orgId) });
  });
}
