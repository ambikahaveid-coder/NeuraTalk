/**
 * Bot auto-responders: a business sets keywords (or quick-reply buttons) and
 * NeuraTalk answers the customer automatically, as the business.
 *
 *   "price" / "rate" / "ధర"  ->  "Kaju Barfi Rs 450/500 g ..."  [Order now] [Location]
 *
 * A reply can carry up to 3 buttons; a tapped quick-reply button can trigger
 * another responder, so a business can build a simple menu bot.
 *
 * Safety:
 *  - only a CUSTOMER's message can trigger a responder (never the business's
 *    own or automatic messages), so responders can't loop;
 *  - at most one responder answers a message (highest priority, then oldest),
 *    recorded with a unique key on the customer's message, so a retried
 *    delivery never answers twice;
 *  - per-responder cooldown per conversation, and at most
 *    MAX_REPLIES_PER_WINDOW automatic answers per conversation per window.
 */
import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { businessConversations, customers, PERMISSIONS, users } from "@shared/schema";
import { requireAuth, requireCompanyAccess, requirePermission, requireRole } from "../../role-middleware";
import { logger } from "../../observability";
import { messageButtonsSchema } from "./template-send";
import { getAutomationControls } from "./automation-admin";
import { foreignOrMissingItems, MAX_PRODUCTS_PER_CARD, productCardMessage } from "./catalog";

const rows = <T>(r: unknown) => (r as { rows: T[] }).rows;

export const MAX_RESPONDERS_PER_BUSINESS = 50;
export const MAX_REPLIES_PER_WINDOW = 5;
export const REPLY_WINDOW_MINUTES = 10;

export async function ensureAutoResponderTables(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "business_auto_responders" (
      "id" serial PRIMARY KEY NOT NULL,
      "business_id" integer NOT NULL,
      "name" text NOT NULL,
      "trigger_type" text NOT NULL DEFAULT 'keyword',
      "match_type" text NOT NULL DEFAULT 'contains',
      "keywords" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "reply_text" text NOT NULL,
      "buttons" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "form_id" integer,
      "priority" integer NOT NULL DEFAULT 100,
      "cooldown_seconds" integer NOT NULL DEFAULT 60,
      "is_active" boolean NOT NULL DEFAULT true,
      "created_by" integer,
      "created_at" timestamp DEFAULT now(),
      "updated_at" timestamp DEFAULT now()
    )`);
  // Catalog responder: product cards sent after the reply (added Nov 2026).
  await db.execute(sql`ALTER TABLE "business_auto_responders" ADD COLUMN IF NOT EXISTS "product_ids" jsonb NOT NULL DEFAULT '[]'::jsonb`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "business_auto_responders_business_idx" ON "business_auto_responders" ("business_id", "is_active")`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "business_auto_responder_runs" (
      "id" serial PRIMARY KEY NOT NULL,
      "responder_id" integer NOT NULL REFERENCES "business_auto_responders"("id") ON DELETE CASCADE,
      "business_id" integer NOT NULL,
      "business_conversation_id" integer NOT NULL,
      "trigger_message_id" integer NOT NULL,
      "reply_message_id" integer,
      "matched" text,
      "created_at" timestamp DEFAULT now()
    )`);
  // One automatic answer per customer message, even if delivery is retried.
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "business_auto_responder_runs_once" ON "business_auto_responder_runs" ("trigger_message_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "business_auto_responder_runs_conv_idx" ON "business_auto_responder_runs" ("business_conversation_id", "created_at")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "business_auto_responder_runs_business_idx" ON "business_auto_responder_runs" ("business_id", "created_at")`);
}

export const MATCH_TYPES = ["exact", "contains", "starts_with"] as const;
export const TRIGGER_TYPES = ["keyword", "button"] as const;

export const responderSchema = z.object({
  name: z.string().trim().min(2, "Give it a short name").max(60),
  triggerType: z.enum(TRIGGER_TYPES).default("keyword"),
  matchType: z.enum(MATCH_TYPES).default("contains"),
  // Keywords (or, for "button", the quick-reply button ids or titles to react to).
  keywords: z.array(z.string().trim().min(1).max(60)).min(1, "Add at least one keyword").max(20)
    .transform((k) => Array.from(new Set(k.map((x) => x.trim())))),
  replyText: z.string().trim().min(1, "Write the reply").max(1000),
  buttons: messageButtonsSchema.default([]),
  formId: z.number().int().positive().nullable().optional(),
  // Catalog responder: up to 10 products sent as cards after the reply.
  productIds: z.array(z.number().int().positive()).max(MAX_PRODUCTS_PER_CARD).default([]).transform((a) => Array.from(new Set(a))),
  priority: z.number().int().min(1).max(1000).default(100),
  cooldownSeconds: z.number().int().min(0).max(86_400).default(60),
  isActive: z.boolean().default(true),
});
export type ResponderInput = z.infer<typeof responderSchema>;

type ResponderRow = {
  id: number; business_id: number; name: string; trigger_type: string; match_type: string; keywords: string[];
  reply_text: string; buttons: unknown[]; form_id: number | null; product_ids: number[]; priority: number; cooldown_seconds: number;
  is_active: boolean; created_at: Date; updated_at: Date;
};

const present = (r: ResponderRow, extra: Record<string, unknown> = {}) => ({
  id: r.id, name: r.name, triggerType: r.trigger_type, matchType: r.match_type, keywords: r.keywords,
  replyText: r.reply_text, buttons: r.buttons, formId: r.form_id, productIds: r.product_ids ?? [], priority: r.priority,
  cooldownSeconds: r.cooldown_seconds, isActive: r.is_active, createdAt: r.created_at, updatedAt: r.updated_at, ...extra,
});

const EDGE_PUNCTUATION = new RegExp("^[\\s\\p{P}\\p{S}]+|[\\s\\p{P}\\p{S}]+$", "gu");

/** Lower-case, unify Unicode forms, drop surrounding punctuation, single spaces. */
export function normalizeForMatch(text: string): string {
  return String(text ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[​-‍﻿]/g, "")
    .replace(/[\s]+/g, " ")
    .replace(EDGE_PUNCTUATION, "")
    .trim();
}

/** Does `text` match `keyword` under `matchType`? Whole-word for "contains". */
export function keywordMatches(text: string, keyword: string, matchType: string): boolean {
  const t = normalizeForMatch(text);
  const k = normalizeForMatch(keyword);
  if (!t || !k) return false;
  if (matchType === "exact") return t === k;
  if (matchType === "starts_with") return t === k || t.startsWith(k + " ") || t.startsWith(k);
  // contains: as a whole word/phrase, so "hi" doesn't fire on "this".
  const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "u").test(t);
}

export type TriggerMessage = { text: string; buttonId?: string | null; buttonTitle?: string | null };

/** The responder that answers this message (highest priority, then oldest), or null. */
export function pickResponder<T extends { trigger_type: string; match_type: string; keywords: string[]; priority: number; id: number }>(
  responders: T[], message: TriggerMessage,
): { responder: T; matched: string } | null {
  const ordered = [...responders].sort((a, b) => b.priority - a.priority || a.id - b.id);
  for (const r of ordered) {
    for (const k of r.keywords) {
      if (r.trigger_type === "button") {
        const kk = normalizeForMatch(k);
        if (message.buttonId && normalizeForMatch(message.buttonId) === kk) return { responder: r, matched: k };
        if (message.buttonTitle && normalizeForMatch(message.buttonTitle) === kk) return { responder: r, matched: k };
        continue;
      }
      if (keywordMatches(message.text, k, r.match_type)) return { responder: r, matched: k };
    }
  }
  return null;
}

export function renderReply(template: string, vars: { name?: string | null }): string {
  // A customer saved without a name has their phone number as name: never greet with a number.
  const name = /[^\d\s+()-]/.test(vars.name ?? "") ? (vars.name ?? "").trim() : "";
  const first = name.split(/\s+/)[0] ?? "";
  return template.replace(/\{\{\s*(name|first_name)\s*\}\}/gi, (_m, key: string) => (key.toLowerCase() === "name" ? name : first) || "there");
}

/**
 * Called after a customer's message committed (from sendAutoRepliesAfterCustomerMessage).
 * Returns true when a responder answered. Never throws.
 */
export async function runAutoResponders(input: {
  businessId: number; businessConversationId: number; conversationId: number;
  triggerMessageId: number; message: TriggerMessage;
  send: (content: string, extra: { messageType?: string; metadata?: Record<string, unknown> }) => Promise<number | null>;
}): Promise<boolean> {
  try {
    const active = rows<ResponderRow>(await db.execute(sql`
      SELECT * FROM business_auto_responders WHERE business_id = ${input.businessId} AND is_active`));
    if (!active.length) return false;
    if ((await getAutomationControls(input.businessId)).botsPaused) return false;
    const pick = pickResponder(active, input.message);
    if (!pick) return false;
    const r = pick.responder;

    // Conversation-wide cap (protects customers and the business from runaway menus).
    const [{ n }] = rows<{ n: number }>(await db.execute(sql`
      SELECT count(*)::int AS n FROM business_auto_responder_runs
      WHERE business_conversation_id = ${input.businessConversationId}
        AND created_at > now() - make_interval(mins => ${REPLY_WINDOW_MINUTES})`));
    if (n >= MAX_REPLIES_PER_WINDOW) return false;
    if (r.cooldown_seconds > 0) {
      const [{ recent }] = rows<{ recent: number }>(await db.execute(sql`
        SELECT count(*)::int AS recent FROM business_auto_responder_runs
        WHERE responder_id = ${r.id} AND business_conversation_id = ${input.businessConversationId}
          AND created_at > now() - make_interval(secs => ${r.cooldown_seconds})`));
      if (recent > 0) return false;
    }

    // Claim this customer message first: a retry or a parallel call can't answer twice.
    const claimed = rows<{ id: number }>(await db.execute(sql`
      INSERT INTO business_auto_responder_runs (responder_id, business_id, business_conversation_id, trigger_message_id, matched)
      VALUES (${r.id}, ${input.businessId}, ${input.businessConversationId}, ${input.triggerMessageId}, ${pick.matched})
      ON CONFLICT (trigger_message_id) DO NOTHING RETURNING id`));
    if (!claimed.length) return false;

    const [conv] = await db.select({ customerId: businessConversations.customerId }).from(businessConversations)
      .where(and(eq(businessConversations.id, input.businessConversationId), eq(businessConversations.businessId, input.businessId)));
    const [customer] = conv?.customerId
      ? await db.select({ name: customers.name, linkedUserId: customers.linkedUserId }).from(customers).where(and(eq(customers.id, conv.customerId), eq(customers.businessId, input.businessId)))
      : [];
    let name = customer?.name ?? null;
    if (!/[^\d\s+()-]/.test(name ?? "") && customer?.linkedUserId) {
      const [u] = await db.select({ displayName: users.displayName }).from(users).where(eq(users.id, customer.linkedUserId));
      name = u?.displayName ?? null;
    }
    const content = renderReply(r.reply_text, { name });

    let replyId: number | null = null;
    if (r.form_id) {
      const [form] = rows<{ id: number; title: string; intro: string | null; fields: unknown }>(await db.execute(sql`
        SELECT id, title, intro, fields FROM business_forms WHERE id = ${r.form_id} AND business_id = ${input.businessId} AND is_active`));
      if (form) {
        await input.send(content, {});
        replyId = await input.send(`📝 ${form.title}`, { messageType: "form", metadata: { form: { id: form.id, title: form.title, intro: form.intro, fields: form.fields }, autoResponderId: r.id } });
      }
    }
    if (!replyId) {
      const buttons = Array.isArray(r.buttons) ? r.buttons : [];
      replyId = await input.send(content, { metadata: { ...(buttons.length ? { buttons } : {}), autoResponderId: r.id } });
    }
    // Catalog responder: current, available products only (a deleted or sold-out item is skipped).
    const productIds = Array.isArray(r.product_ids) ? r.product_ids.map(Number) : [];
    if (productIds.length) {
      const card = await productCardMessage(input.businessId, productIds);
      if (card) {
        const cardId = await input.send(card.content, { messageType: "product", metadata: { ...card.metadata, autoResponderId: r.id } });
        replyId = replyId ?? cardId;
      }
    }
    await db.execute(sql`UPDATE business_auto_responder_runs SET reply_message_id = ${replyId} WHERE id = ${claimed[0].id}`);
    return replyId != null;
  } catch (error) {
    logger.warn("AutoResponders", `business ${input.businessId}: ${String(error)}`);
    return false;
  }
}

function validIds(req: Request, res: Response, next: NextFunction) {
  for (const key of ["businessId", "responderId"]) {
    const v = req.params[key];
    if (v !== undefined && !(Number.isSafeInteger(Number(v)) && Number(v) > 0)) return res.status(400).json({ success: false, error: "Invalid id." });
  }
  next();
}

async function formBelongs(businessId: number, formId: number | null | undefined): Promise<boolean> {
  if (!formId) return true;
  const found = rows<{ id: number }>(await db.execute(sql`SELECT id FROM business_forms WHERE id = ${formId} AND business_id = ${businessId} AND is_active`));
  return found.length > 0;
}

export function registerAutoResponderRoutes(app: Express): void {
  const view = [requireAuth, validIds, requireCompanyAccess("businessId"), requirePermission(PERMISSIONS.MESSAGING_SEND)];
  const manage = [requireAuth, validIds, requireCompanyAccess("businessId"), requireRole("company_admin", "super_admin")];
  const base = "/api/business/:businessId/auto-responders";

  app.get(base, ...view, async (req: Request, res: Response) => {
    const businessId = Number(req.params.businessId);
    const list = rows<ResponderRow & { hits: number; last_hit_at: Date | null }>(await db.execute(sql`
      SELECT r.*, (SELECT count(*)::int FROM business_auto_responder_runs x WHERE x.responder_id = r.id) AS hits,
        (SELECT max(created_at) FROM business_auto_responder_runs x WHERE x.responder_id = r.id) AS last_hit_at
      FROM business_auto_responders r WHERE r.business_id = ${businessId}
      ORDER BY r.priority DESC, r.id ASC`));
    const controls = await getAutomationControls(businessId);
    res.json({ success: true, responders: list.map((r) => present(r, { hits: r.hits, lastHitAt: r.last_hit_at })),
      pausedByNeuraTalk: controls.botsPaused ? { reason: controls.reason } : null, limits: { maxResponders: MAX_RESPONDERS_PER_BUSINESS, maxRepliesPerWindow: MAX_REPLIES_PER_WINDOW, windowMinutes: REPLY_WINDOW_MINUTES } });
  });

  app.post(base, ...manage, async (req: Request, res: Response) => {
    const businessId = Number(req.params.businessId);
    const parsed = responderSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? "Check the auto-reply." });
    const d = parsed.data;
    if (!(await formBelongs(businessId, d.formId))) return res.status(400).json({ success: false, error: "That form doesn't exist." });
    if ((await foreignOrMissingItems(businessId, d.productIds)).length) return res.status(400).json({ success: false, error: "Some products aren't in your catalog." });
    const [{ n }] = rows<{ n: number }>(await db.execute(sql`SELECT count(*)::int AS n FROM business_auto_responders WHERE business_id = ${businessId}`));
    if (n >= MAX_RESPONDERS_PER_BUSINESS) return res.status(400).json({ success: false, error: `You can keep up to ${MAX_RESPONDERS_PER_BUSINESS} auto-replies.` });
    const [r] = rows<ResponderRow>(await db.execute(sql`
      INSERT INTO business_auto_responders (business_id, name, trigger_type, match_type, keywords, reply_text, buttons, form_id, product_ids, priority, cooldown_seconds, is_active, created_by)
      VALUES (${businessId}, ${d.name}, ${d.triggerType}, ${d.matchType}, ${JSON.stringify(d.keywords)}::jsonb, ${d.replyText}, ${JSON.stringify(d.buttons)}::jsonb,
        ${d.formId ?? null}, ${JSON.stringify(d.productIds)}::jsonb, ${d.priority}, ${d.cooldownSeconds}, ${d.isActive}, ${req.user!.id})
      RETURNING *`));
    res.status(201).json({ success: true, responder: present(r) });
  });

  app.put(`${base}/:responderId`, ...manage, async (req: Request, res: Response) => {
    const businessId = Number(req.params.businessId);
    const parsed = responderSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? "Check the auto-reply." });
    const d = parsed.data;
    if (!(await formBelongs(businessId, d.formId))) return res.status(400).json({ success: false, error: "That form doesn't exist." });
    if ((await foreignOrMissingItems(businessId, d.productIds)).length) return res.status(400).json({ success: false, error: "Some products aren't in your catalog." });
    const updated = rows<ResponderRow>(await db.execute(sql`
      UPDATE business_auto_responders SET name = ${d.name}, trigger_type = ${d.triggerType}, match_type = ${d.matchType},
        keywords = ${JSON.stringify(d.keywords)}::jsonb, reply_text = ${d.replyText}, buttons = ${JSON.stringify(d.buttons)}::jsonb,
        form_id = ${d.formId ?? null}, product_ids = ${JSON.stringify(d.productIds)}::jsonb, priority = ${d.priority}, cooldown_seconds = ${d.cooldownSeconds}, is_active = ${d.isActive}, updated_at = now()
      WHERE id = ${Number(req.params.responderId)} AND business_id = ${businessId} RETURNING *`));
    if (!updated.length) return res.status(404).json({ success: false, error: "Auto-reply not found." });
    res.json({ success: true, responder: present(updated[0]) });
  });

  app.delete(`${base}/:responderId`, ...manage, async (req: Request, res: Response) => {
    const removed = rows<{ id: number }>(await db.execute(sql`
      DELETE FROM business_auto_responders WHERE id = ${Number(req.params.responderId)} AND business_id = ${Number(req.params.businessId)} RETURNING id`));
    if (!removed.length) return res.status(404).json({ success: false, error: "Auto-reply not found." });
    res.json({ success: true });
  });

  /** Dry run: which auto-reply would answer this message, and with what. Sends nothing. */
  app.post(`${base}/test`, ...view, async (req: Request, res: Response) => {
    const parsed = z.object({ text: z.string().max(4000).default(""), buttonId: z.string().max(60).optional() }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ success: false, error: "Write a test message." });
    const active = rows<ResponderRow>(await db.execute(sql`
      SELECT * FROM business_auto_responders WHERE business_id = ${Number(req.params.businessId)} AND is_active`));
    const pick = pickResponder(active, { text: parsed.data.text, buttonId: parsed.data.buttonId, buttonTitle: parsed.data.text });
    res.json({
      success: true,
      match: pick ? { responder: present(pick.responder), matched: pick.matched, reply: renderReply(pick.responder.reply_text, { name: "Kiran" }) } : null,
    });
  });

  app.get(`${base}/runs`, ...view, async (req: Request, res: Response) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const list = rows<{ id: number; responder_id: number; name: string; matched: string; business_conversation_id: number; customer_name: string | null; created_at: Date }>(await db.execute(sql`
      SELECT x.id, x.responder_id, r.name, x.matched, x.business_conversation_id, c.name AS customer_name, x.created_at
      FROM business_auto_responder_runs x
      JOIN business_auto_responders r ON r.id = x.responder_id
      LEFT JOIN business_conversations bc ON bc.id = x.business_conversation_id AND bc.business_id = x.business_id
      LEFT JOIN customers c ON c.id = bc.customer_id AND c.business_id = x.business_id
      WHERE x.business_id = ${Number(req.params.businessId)}
      ORDER BY x.created_at DESC LIMIT ${limit}`));
    res.json({ success: true, runs: list.map((x) => ({ id: x.id, responderId: x.responder_id, responderName: x.name, matched: x.matched, conversationId: x.business_conversation_id, customerName: x.customer_name, createdAt: x.created_at })) });
  });
}
