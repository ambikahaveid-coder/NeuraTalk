/**
 * Click-to-chat ads inside NeuraTalk (our own, not Facebook/Instagram).
 *
 * A business writes a short ad (headline + one line + button). NeuraTalk
 * reviews it. Approved ads show as "Sponsored" in customers' Business
 * messages screen (app and web). A customer who taps "Chat" lands in the
 * business's chat; the business pays per chat started from its wallet
 * (AD_CHAT_PRICE_PAISE, default ₹2), at most once per person per day, and
 * never more than its daily budget. Showing an ad costs nothing.
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { PERMISSIONS } from "@shared/schema";
import { requireAuth, requireCompanyAccess, requirePermission, requireRole } from "../../role-middleware";
import { chargeMessage } from "../billing/message-billing";

export const adChatPricePaise = () => {
  const n = Number(process.env.AD_CHAT_PRICE_PAISE ?? 200);
  return Number.isInteger(n) && n > 0 && n <= 10_000 ? n : 200;
};
const MAX_ACTIVE_ADS = 5;

export async function ensureBusinessAdTables(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "business_ads" (
      "id" serial PRIMARY KEY,
      "business_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "headline" text NOT NULL,
      "body" text NOT NULL,
      "button" text NOT NULL DEFAULT 'Chat now',
      "image_url" text,
      "city" text,
      "daily_budget_paise" integer NOT NULL,
      "status" text NOT NULL DEFAULT 'pending',
      "review_note" text,
      "reviewed_by" integer,
      "reviewed_at" timestamp,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "business_ads_status" ON "business_ads" ("status")`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "business_ad_events" (
      "id" serial PRIMARY KEY,
      "ad_id" integer NOT NULL REFERENCES "business_ads"("id") ON DELETE CASCADE,
      "user_id" integer NOT NULL,
      "kind" text NOT NULL,
      "day" date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date,
      "cost_paise" integer NOT NULL DEFAULT 0,
      "created_at" timestamp NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "business_ad_events_once" ON "business_ad_events" ("ad_id", "user_id", "kind", "day")`);
}

const rows = <T>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? []) as T[];
const idOf = (v: unknown) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };

const adInput = z.object({
  headline: z.string().trim().min(3).max(60),
  body: z.string().trim().min(3).max(140),
  button: z.string().trim().min(2).max(20).default("Chat now"),
  imageUrl: z.string().trim().max(2000).refine((v) => v.startsWith("/objects/") || v.startsWith("https://"), "Upload the picture first").optional().nullable(),
  city: z.string().trim().max(60).optional().nullable(),
  dailyBudgetPaise: z.number().int().min(5000, "The smallest daily budget is ₹50").max(10_00_000, "The largest daily budget is ₹10,000"),
});

const STATS = sql`
  (SELECT count(*)::int FROM business_ad_events e WHERE e.ad_id = a.id AND e.kind = 'view') AS views,
  (SELECT count(*)::int FROM business_ad_events e WHERE e.ad_id = a.id AND e.kind = 'chat') AS chats,
  (SELECT coalesce(sum(e.cost_paise), 0)::int FROM business_ad_events e WHERE e.ad_id = a.id AND e.kind = 'chat') AS "spentPaise",
  (SELECT coalesce(sum(e.cost_paise), 0)::int FROM business_ad_events e WHERE e.ad_id = a.id AND e.kind = 'chat' AND e.day = (now() AT TIME ZONE 'Asia/Kolkata')::date) AS "spentTodayPaise"`;

function present(a: any) {
  return {
    id: a.id, businessId: a.business_id, headline: a.headline, body: a.body, button: a.button, imageUrl: a.image_url, city: a.city,
    dailyBudgetPaise: a.daily_budget_paise, status: a.status, reviewNote: a.review_note, createdAt: a.created_at,
    views: a.views ?? 0, chats: a.chats ?? 0, spentPaise: a.spentPaise ?? 0, spentTodayPaise: a.spentTodayPaise ?? 0,
    ...(a.business_name ? { businessName: a.business_name } : {}),
  };
}

export function registerBusinessAdRoutes(app: Express): void {
  const view = [requireAuth, requireCompanyAccess("businessId"), requirePermission(PERMISSIONS.MESSAGING_VIEW)];
  const manage = [requireAuth, requireCompanyAccess("businessId"), requirePermission(PERMISSIONS.MESSAGING_SEND)];

  // ---------------------------------------------------------------- business
  app.get("/api/business/:businessId/ads", ...view, async (req: Request, res: Response) => {
    const list = rows(await db.execute(sql`SELECT a.*, ${STATS} FROM business_ads a WHERE a.business_id = ${Number(req.params.businessId)} ORDER BY a.created_at DESC`));
    res.json({ success: true, ads: list.map(present), pricePerChatPaise: adChatPricePaise() });
  });

  app.post("/api/business/:businessId/ads", ...manage, async (req: Request, res: Response) => {
    const businessId = Number(req.params.businessId);
    const parsed = adInput.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? "Check the ad." });
    const [{ n }] = rows<{ n: number }>(await db.execute(sql`SELECT count(*)::int AS n FROM business_ads WHERE business_id = ${businessId} AND status IN ('pending', 'approved', 'paused')`));
    if (n >= MAX_ACTIVE_ADS) return res.status(400).json({ success: false, error: `You can have up to ${MAX_ACTIVE_ADS} ads at a time. End one first.` });
    const a = parsed.data;
    const created = rows(await db.execute(sql`
      INSERT INTO business_ads (business_id, headline, body, button, image_url, city, daily_budget_paise)
      VALUES (${businessId}, ${a.headline}, ${a.body}, ${a.button}, ${a.imageUrl ?? null}, ${a.city ?? null}, ${a.dailyBudgetPaise})
      RETURNING *`))[0];
    res.status(201).json({ success: true, ad: present(created), review: "pending" });
  });

  /** Pause/resume/end, or change the budget. Changing the words sends it back to review. */
  app.patch("/api/business/:businessId/ads/:adId", ...manage, async (req: Request, res: Response) => {
    const businessId = Number(req.params.businessId);
    const adId = idOf(req.params.adId);
    const parsed = z.object({
      action: z.enum(["pause", "resume", "end"]).optional(),
      dailyBudgetPaise: adInput.shape.dailyBudgetPaise.optional(),
      headline: adInput.shape.headline.optional(), body: adInput.shape.body.optional(), button: z.string().trim().min(2).max(20).optional(),
    }).safeParse(req.body ?? {});
    if (!adId || !parsed.success) return res.status(400).json({ success: false, error: parsed.success ? "Invalid ad." : parsed.error.issues[0]?.message });
    const [ad] = rows<any>(await db.execute(sql`SELECT * FROM business_ads WHERE id = ${adId} AND business_id = ${businessId}`));
    if (!ad) return res.status(404).json({ success: false, error: "Ad not found." });
    if (ad.status === "ended" || ad.status === "rejected") return res.status(409).json({ success: false, error: `This ad is ${ad.status}. Make a new one.` });
    const d = parsed.data;
    let status = ad.status as string;
    if (d.action === "pause") status = ad.status === "approved" ? "paused" : ad.status;
    if (d.action === "resume") status = ad.status === "paused" ? "approved" : ad.status;
    if (d.action === "end") status = "ended";
    const wordsChanged = (d.headline && d.headline !== ad.headline) || (d.body && d.body !== ad.body) || (d.button && d.button !== ad.button);
    if (wordsChanged && status !== "ended") status = "pending";
    const updated = rows(await db.execute(sql`
      UPDATE business_ads SET status = ${status}, headline = ${d.headline ?? ad.headline}, body = ${d.body ?? ad.body}, button = ${d.button ?? ad.button},
        daily_budget_paise = ${d.dailyBudgetPaise ?? ad.daily_budget_paise}, updated_at = now()
      WHERE id = ${adId} RETURNING *`))[0];
    res.json({ success: true, ad: present(updated) });
  });

  // ---------------------------------------------------------------- NeuraTalk review
  app.get("/api/admin/business-ads", requireAuth, requireRole("super_admin"), async (req: Request, res: Response) => {
    const status = String(req.query.status ?? "pending");
    const filter = ["pending", "approved", "paused", "rejected", "ended"].includes(status) ? sql`WHERE a.status = ${status}` : sql``;
    const list = rows(await db.execute(sql`
      SELECT a.*, o.name AS business_name, ${STATS} FROM business_ads a JOIN organizations o ON o.id = a.business_id ${filter}
      ORDER BY a.created_at DESC LIMIT 200`));
    res.json({ success: true, ads: list.map(present) });
  });

  app.post("/api/admin/business-ads/:adId/:decision", requireAuth, requireRole("super_admin"), async (req: Request, res: Response) => {
    const adId = idOf(req.params.adId);
    const decision = req.params.decision;
    const note = z.string().trim().max(300).optional().safeParse(req.body?.note);
    if (!adId || !["approve", "reject", "stop"].includes(decision)) return res.status(400).json({ success: false, error: "Invalid request." });
    if (decision === "reject" && !(note.success && note.data)) return res.status(400).json({ success: false, error: "Say why, so the business can fix it." });
    const status = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "ended";
    const from = decision === "stop" ? sql`status IN ('approved', 'paused', 'pending')` : sql`status = 'pending'`;
    const updated = rows(await db.execute(sql`
      UPDATE business_ads SET status = ${status}, review_note = ${note.success ? note.data ?? null : null}, reviewed_by = ${req.user!.id}, reviewed_at = now(), updated_at = now()
      WHERE id = ${adId} AND ${from} RETURNING *`))[0];
    if (!updated) return res.status(409).json({ success: false, error: "This ad was already reviewed." });
    res.json({ success: true, ad: present(updated) });
  });

  // ---------------------------------------------------------------- customers
  /** Up to 2 sponsored businesses for this person (never their own, nor ones they blocked). */
  app.get("/api/ads/feed", requireAuth, async (req: Request, res: Response) => {
    const me = req.user!.id;
    const list = rows<any>(await db.execute(sql`
      SELECT a.id, a.business_id, a.headline, a.body, a.button, a.image_url, o.name AS business_name, o.logo_url
      FROM business_ads a
      JOIN organizations o ON o.id = a.business_id AND o.is_active = true AND o.status = 'approved'
      JOIN billing_accounts b ON b.organization_id = a.business_id AND b.is_blocked = false AND b.wallet_balance_paise >= ${adChatPricePaise()}
      WHERE a.status = 'approved'
        AND (SELECT coalesce(sum(e.cost_paise), 0) FROM business_ad_events e WHERE e.ad_id = a.id AND e.kind = 'chat' AND e.day = (now() AT TIME ZONE 'Asia/Kolkata')::date) + ${adChatPricePaise()} <= a.daily_budget_paise
        AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = ${me} AND u.organization_id = a.business_id)
        AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.business_id = a.business_id AND c.linked_user_id = ${me} AND c.blocked_by_customer_at IS NOT NULL)
      ORDER BY random() LIMIT 2`));
    for (const a of list) {
      await db.execute(sql`INSERT INTO business_ad_events (ad_id, user_id, kind) VALUES (${a.id}, ${me}, 'view') ON CONFLICT DO NOTHING`);
    }
    res.json({
      success: true,
      ads: list.map((a) => ({ id: a.id, businessId: a.business_id, businessName: a.business_name, logoUrl: a.logo_url, headline: a.headline, body: a.body, button: a.button, imageUrl: a.image_url })),
    });
  });

  /** "Chat now": the business pays for this new chat (once per person per day). */
  app.post("/api/ads/:adId/chat", requireAuth, async (req: Request, res: Response) => {
    const me = req.user!.id;
    const adId = idOf(req.params.adId);
    const [ad] = adId ? rows<any>(await db.execute(sql`SELECT * FROM business_ads WHERE id = ${adId}`)) : [];
    if (!ad || ad.status !== "approved") return res.status(404).json({ success: false, error: "This offer has ended." });
    const price = adChatPricePaise();
    const charged = await db.transaction(async (tx) => {
      const ins = rows(await tx.execute(sql`
        INSERT INTO business_ad_events (ad_id, user_id, kind, cost_paise) VALUES (${ad.id}, ${me}, 'chat', ${price})
        ON CONFLICT (ad_id, user_id, kind, day) DO NOTHING RETURNING id`));
      if (!ins.length) return "repeat";
      const [{ spent }] = rows<{ spent: number }>(await tx.execute(sql`
        SELECT coalesce(sum(cost_paise), 0)::int AS spent FROM business_ad_events WHERE ad_id = ${ad.id} AND kind = 'chat' AND day = (now() AT TIME ZONE 'Asia/Kolkata')::date`));
      if (spent > ad.daily_budget_paise) throw new Error("BUDGET");
      const c = await chargeMessage(tx as any, ad.business_id, price, "ads");
      if (!c.charged) throw new Error("NO_CREDIT");
      return "charged";
    }).catch((e: Error) => (e.message === "BUDGET" || e.message === "NO_CREDIT" ? "free" : Promise.reject(e)));
    // Over budget or out of credit: the customer still gets the chat; the business isn't charged.
    res.json({ success: true, businessId: ad.business_id, charged: charged === "charged" });
  });
}
