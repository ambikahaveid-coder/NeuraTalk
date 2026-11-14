/**
 * SMS for customers who don't have NeuraTalk.
 *
 * A business message that can't be delivered in the app (the customer isn't
 * on NeuraTalk) can go out as one SMS instead:
 *
 *   "<Business> sent you a message on NeuraTalk. Read it: neuratalk.in/m/<code>"
 *
 * India requires every SMS text to be pre-registered (TRAI DLT), so NeuraTalk
 * registers that ONE template with MSG91 and the SMS never carries the
 * business's own words. The link opens a page with the real message (in
 * full, codes included) and a way to reply on NeuraTalk.
 *
 * - The business turns it on and picks which kinds (updates, codes, offers).
 * - Each SMS is paid from the business wallet (SMS_PRICE_PAISE, default ₹0.25);
 *   if the SMS can't be sent, the charge is given back.
 * - Off for everyone until NeuraTalk sets MSG91_AUTH_KEY,
 *   MSG91_SMS_TEMPLATE_ID and SMS_FALLBACK_ENABLED=true. SMS_FALLBACK_TEST_MODE=true
 *   (local testing) records what would be sent without sending.
 */
import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { billingAccounts, customers, messagingDeliveries, messagingMessages, organizations, PERMISSIONS, MESSAGE_DELIVERY_STATUS } from "@shared/schema";
import { requireAuth, requireCompanyAccess, requirePermission, requireRole } from "../../role-middleware";
import { chargeMessage } from "../billing/message-billing";
import { logger } from "../../observability";

export const SMS_CATEGORIES = ["utility", "authentication", "marketing"] as const;
const LINK_DAYS = 30;
const PUBLIC_BASE = "https://neuratalk.in";

export type SmsMode = "live" | "test" | "off";
export function smsMode(): SmsMode {
  if (process.env.SMS_FALLBACK_ENABLED === "true" && process.env.MSG91_AUTH_KEY && process.env.MSG91_SMS_TEMPLATE_ID) return "live";
  // Test mode only ever on a local database, never in production.
  if (process.env.SMS_FALLBACK_TEST_MODE === "true" && String(process.env.DATABASE_URL ?? "").includes("localhost")) return "test";
  return "off";
}
export const smsPricePaise = () => {
  const n = Number(process.env.SMS_PRICE_PAISE ?? 25);
  return Number.isInteger(n) && n > 0 && n < 1000 ? n : 25;
};

export async function ensureSmsFallbackTables(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "business_sms_settings" (
      "business_id" integer PRIMARY KEY REFERENCES "organizations"("id") ON DELETE CASCADE,
      "enabled" boolean NOT NULL DEFAULT false,
      "categories" text[] NOT NULL DEFAULT '{utility,authentication}',
      "updated_at" timestamp NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "business_sms_messages" (
      "id" serial PRIMARY KEY,
      "business_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "customer_id" integer,
      "message_id" integer NOT NULL,
      "phone" text NOT NULL,
      "token_hash" text NOT NULL,
      "status" text NOT NULL,
      "provider_ref" text,
      "cost_paise" integer NOT NULL DEFAULT 0,
      "error" text,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "opened_at" timestamp,
      "expires_at" timestamp NOT NULL
    )`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "business_sms_messages_token" ON "business_sms_messages" ("token_hash")`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "business_sms_messages_message" ON "business_sms_messages" ("message_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "business_sms_messages_biz" ON "business_sms_messages" ("business_id", "created_at")`);
}

const rows = <T>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? []) as T[];
const hash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

async function settingsOf(businessId: number): Promise<{ enabled: boolean; categories: string[] }> {
  const r = rows<{ enabled: boolean; categories: string[] }>(await db.execute(sql`SELECT enabled, categories FROM business_sms_settings WHERE business_id = ${businessId}`))[0];
  return r ? { enabled: r.enabled, categories: r.categories } : { enabled: false, categories: ["utility", "authentication"] };
}

/** Indian mobile numbers only (DLT SMS is India-only): 91XXXXXXXXXX. */
export function smsNumber(phone: string | null | undefined): string | null {
  const digits = String(phone ?? "").replace(/\D/g, "");
  const ten = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits.length === 11 && digits.startsWith("0") ? digits.slice(1) : digits;
  return /^[6-9]\d{9}$/.test(ten) ? `91${ten}` : null;
}

/** The one DLT-registered template, through MSG91's Flow API. */
async function sendViaMsg91(mobile: string, businessName: string, link: string): Promise<{ ok: boolean; ref?: string; error?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch("https://control.msg91.com/api/v5/flow", {
      method: "POST",
      headers: { "content-type": "application/json", authkey: String(process.env.MSG91_AUTH_KEY) },
      body: JSON.stringify({
        template_id: process.env.MSG91_SMS_TEMPLATE_ID,
        short_url: "0",
        recipients: [{ mobiles: mobile, business: businessName.slice(0, 30), link }],
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    const body = await res.json().catch(() => ({})) as { type?: string; message?: string };
    if (!res.ok || body.type === "error") return { ok: false, error: String(body.message ?? `HTTP ${res.status}`).slice(0, 200) };
    return { ok: true, ref: String(body.message ?? "").slice(0, 100) };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) };
  }
}

/**
 * May a message of this kind go to a customer who isn't on NeuraTalk,
 * because it will reach them by SMS? Used by the send paths that used to
 * refuse such customers outright ("Invite them first").
 */
export async function smsCovers(businessId: number, category: string, phone: string | null | undefined, exec: { execute: typeof db.execute } = db): Promise<boolean> {
  if (smsMode() === "off" || !smsNumber(phone)) return false;
  const r = rows<{ enabled: boolean; categories: string[] }>(await exec.execute(sql`SELECT enabled, categories FROM business_sms_settings WHERE business_id = ${businessId}`))[0];
  return !!r?.enabled && r.categories.includes(category);
}

/**
 * Called by delivery.ts when a business message couldn't be delivered in the
 * app. Never throws. Returns true when an SMS went out (or would, in test mode).
 */
export async function trySmsFallback(input: { businessId: number; messageId: number; customerId: number | null; deliveryIds: number[] }): Promise<boolean> {
  try {
    const mode = smsMode();
    if (mode === "off" || !input.customerId) return false;
    const [message] = await db.select({ id: messagingMessages.id, category: messagingMessages.category }).from(messagingMessages).where(eq(messagingMessages.id, input.messageId));
    if (!message) return false;
    const settings = await settingsOf(input.businessId);
    if (!settings.enabled || !settings.categories.includes(String(message.category))) return false;
    const [customer] = await db.select({ phone: customers.phone, normalizedPhone: customers.normalizedPhone }).from(customers).where(eq(customers.id, input.customerId));
    const mobile = smsNumber(customer?.normalizedPhone ?? customer?.phone);
    if (!mobile) return false;
    const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, input.businessId));

    const token = crypto.randomBytes(12).toString("base64url");
    const price = smsPricePaise();
    // One SMS per message, even if delivery runs twice.
    const claimed = rows<{ id: number }>(await db.execute(sql`
      INSERT INTO business_sms_messages (business_id, customer_id, message_id, phone, token_hash, status, cost_paise, expires_at)
      VALUES (${input.businessId}, ${input.customerId}, ${message.id}, ${mobile}, ${hash(token)}, 'pending', 0, now() + ${`${LINK_DAYS} days`}::interval)
      ON CONFLICT (message_id) DO NOTHING RETURNING id`))[0];
    if (!claimed) return false;

    const charge = await chargeMessage(db as any, input.businessId, price, "sms");
    if (!charge.charged) {
      await db.execute(sql`UPDATE business_sms_messages SET status = 'no_credit', error = ${charge.reason ?? "insufficient_credit"} WHERE id = ${claimed.id}`);
      return false;
    }
    const link = `${PUBLIC_BASE}/m/${token}`;
    const sent = mode === "live" ? await sendViaMsg91(mobile, org?.name ?? "A business", link) : { ok: true, ref: "test-mode" };
    if (!sent.ok) {
      // Not sent: give the money back.
      await db.update(billingAccounts).set({ walletBalancePaise: sql`${billingAccounts.walletBalancePaise} + ${price}` }).where(eq(billingAccounts.organizationId, input.businessId));
      await db.execute(sql`
        UPDATE business_message_usage_daily SET messages = greatest(messages - 1, 0), amount_paise = greatest(amount_paise - ${price}, 0)
        WHERE business_id = ${input.businessId} AND day = (now() AT TIME ZONE 'Asia/Kolkata')::date AND category = 'sms'`);
      await db.execute(sql`UPDATE business_sms_messages SET status = 'failed', error = ${sent.error ?? null} WHERE id = ${claimed.id}`);
      logger.warn("SmsFallback", `SMS for message ${message.id} not sent: ${sent.error}`);
      return false;
    }
    await db.execute(sql`UPDATE business_sms_messages SET status = ${mode === "live" ? "sent" : "test"}, provider_ref = ${sent.ref ?? null}, cost_paise = ${price} WHERE id = ${claimed.id}`);
    // The business sees it as sent (by SMS) instead of "not on NeuraTalk".
    if (input.deliveryIds.length) {
      await db.execute(sql`
        UPDATE messaging_deliveries SET status = ${MESSAGE_DELIVERY_STATUS.SENT}, provider_ref = 'sms', failure_reason = NULL, status_at = now()
        WHERE id IN (${sql.join(input.deliveryIds.map((id) => sql`${id}`), sql`, `)})`);
    }
    return true;
  } catch (error) {
    logger.warn("SmsFallback", `failed for message ${input.messageId}: ${String(error)}`);
    return false;
  }
}

export function registerSmsFallbackRoutes(app: Express): void {
  const view = [requireAuth, requireCompanyAccess("businessId"), requirePermission(PERMISSIONS.MESSAGING_VIEW)];
  const manage = [requireAuth, requireCompanyAccess("businessId"), requirePermission(PERMISSIONS.MESSAGING_SEND)];

  app.get("/api/business/:businessId/sms-settings", ...view, async (req: Request, res: Response) => {
    const businessId = Number(req.params.businessId);
    const s = await settingsOf(businessId);
    const stats = rows<{ status: string; n: number; paise: number }>(await db.execute(sql`
      SELECT status, count(*)::int AS n, coalesce(sum(cost_paise), 0)::int AS paise FROM business_sms_messages
      WHERE business_id = ${businessId} AND created_at > now() - interval '30 days' GROUP BY status`));
    const opened = rows<{ n: number }>(await db.execute(sql`SELECT count(*)::int AS n FROM business_sms_messages WHERE business_id = ${businessId} AND opened_at IS NOT NULL AND created_at > now() - interval '30 days'`))[0];
    res.json({
      success: true, settings: s, available: smsMode() !== "off", testMode: smsMode() === "test", pricePaise: smsPricePaise(),
      last30Days: { ...Object.fromEntries(stats.map((x) => [x.status, { count: Number(x.n), amountPaise: Number(x.paise) }])), opened: Number(opened?.n ?? 0) },
    });
  });

  app.put("/api/business/:businessId/sms-settings", ...manage, async (req: Request, res: Response) => {
    const parsed = z.object({ enabled: z.boolean(), categories: z.array(z.enum(SMS_CATEGORIES)).max(3).default(["utility", "authentication"]) }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ success: false, error: "Pick which messages may go by SMS." });
    const businessId = Number(req.params.businessId);
    const cats = `{${Array.from(new Set(parsed.data.categories)).join(",")}}`;
    await db.execute(sql`
      INSERT INTO business_sms_settings (business_id, enabled, categories) VALUES (${businessId}, ${parsed.data.enabled}, ${cats}::text[])
      ON CONFLICT (business_id) DO UPDATE SET enabled = EXCLUDED.enabled, categories = EXCLUDED.categories, updated_at = now()`);
    res.json({ success: true, settings: await settingsOf(businessId), available: smsMode() !== "off" });
  });

  app.get("/api/business/:businessId/sms-messages", ...view, async (req: Request, res: Response) => {
    const list = rows(await db.execute(sql`
      SELECT s.id, s.message_id AS "messageId", s.status, s.cost_paise AS "costPaise", s.created_at AS "createdAt", s.opened_at AS "openedAt",
             '******' || right(s.phone, 4) AS phone, c.name AS "customerName"
      FROM business_sms_messages s LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.business_id = ${Number(req.params.businessId)} ORDER BY s.created_at DESC LIMIT 100`));
    res.json({ success: true, messages: list });
  });

  // Super admin: is SMS on, and what went out across all businesses.
  app.get("/api/admin/sms-fallback", requireAuth, requireRole("super_admin"), async (_req: Request, res: Response) => {
    const byBiz = rows(await db.execute(sql`
      SELECT s.business_id AS "businessId", o.name, count(*)::int AS sms, coalesce(sum(s.cost_paise), 0)::int AS "amountPaise",
             count(*) FILTER (WHERE s.status = 'failed')::int AS failed, count(*) FILTER (WHERE s.opened_at IS NOT NULL)::int AS opened
      FROM business_sms_messages s JOIN organizations o ON o.id = s.business_id
      WHERE s.created_at > now() - interval '30 days' GROUP BY s.business_id, o.name ORDER BY sms DESC LIMIT 100`));
    const enabled = rows<{ n: number }>(await db.execute(sql`SELECT count(*)::int AS n FROM business_sms_settings WHERE enabled`))[0];
    res.json({
      success: true, mode: smsMode(), pricePaise: smsPricePaise(), businessesTurnedOn: Number(enabled?.n ?? 0), last30Days: byBiz,
      setup: {
        MSG91_AUTH_KEY: !!process.env.MSG91_AUTH_KEY, MSG91_SMS_TEMPLATE_ID: !!process.env.MSG91_SMS_TEMPLATE_ID,
        SMS_FALLBACK_ENABLED: process.env.SMS_FALLBACK_ENABLED === "true",
      },
    });
  });

  // ---------------------------------------------------------------- the link in the SMS (public)
  app.get("/api/sms-links/:token", async (req: Request, res: Response) => {
    const token = String(req.params.token ?? "");
    if (!/^[A-Za-z0-9_-]{10,40}$/.test(token)) return res.status(404).json({ success: false, error: "This link isn't valid." });
    const s = rows<{ id: number; business_id: number; message_id: number; expires_at: Date; opened_at: Date | null }>(await db.execute(sql`
      SELECT id, business_id, message_id, expires_at, opened_at FROM business_sms_messages WHERE token_hash = ${hash(token)} AND status IN ('sent', 'test')`))[0];
    if (!s) return res.status(404).json({ success: false, error: "This link isn't valid." });
    if (new Date(s.expires_at).getTime() < Date.now()) return res.status(410).json({ success: false, error: "This link has expired. Ask the business to message you again." });
    const [message] = await db.select().from(messagingMessages).where(eq(messagingMessages.id, s.message_id));
    const [org] = await db.select({ name: organizations.name, logoUrl: organizations.logoUrl, slug: organizations.slug }).from(organizations).where(eq(organizations.id, s.business_id));
    if (!message) return res.status(404).json({ success: false, error: "This message was removed." });
    // The phone's owner opened it: show any login code in full.
    const { revealInAppOtpCodes } = await import("../otp/reveal");
    const [shown] = await revealInAppOtpCodes([message]);
    if (!s.opened_at) {
      await db.execute(sql`UPDATE business_sms_messages SET opened_at = now() WHERE id = ${s.id}`);
      await db.execute(sql`
        UPDATE messaging_deliveries SET status = ${MESSAGE_DELIVERY_STATUS.READ}, status_at = now()
        WHERE message_id = ${s.message_id} AND provider_ref = 'sms' AND status = ${MESSAGE_DELIVERY_STATUS.SENT}`);
    }
    const slug = org?.slug ?? null;
    res.json({
      success: true,
      business: { id: s.business_id, name: org?.name ?? "Business", logoUrl: org?.logoUrl ?? null, chatLink: slug ? `/b/${slug}` : `/business-chat/${s.business_id}` },
      message: { content: shown.content, createdAt: message.createdAt, metadata: { header: (message.metadata as any)?.header ?? null, footer: (message.metadata as any)?.footer ?? null } },
    });
  });
}
