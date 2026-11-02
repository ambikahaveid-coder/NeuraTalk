/**
 * NeuraTalk's control over business automation (super admin):
 *  - see every company's auto-reply bots and API sends (counts, failures, cost)
 *  - pause a company's bots and/or API sending, with a reason the company sees
 * Every API call (/api/v1/...) is recorded: which key, what kind, result code,
 * charge. Message text and phone numbers are NOT recorded here.
 */
import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { AUDIT_ACTION } from "@shared/schema";
import { requireAuth, requireRole } from "../../role-middleware";
import { createAuditLog } from "../../audit";
import { logger } from "../../observability";

const rows = <T>(r: unknown) => (r as { rows: T[] }).rows;

export async function ensureAutomationAdminTables(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "business_automation_controls" (
      "business_id" integer PRIMARY KEY NOT NULL,
      "bots_paused" boolean NOT NULL DEFAULT false,
      "api_paused" boolean NOT NULL DEFAULT false,
      "reason" text,
      "updated_by" integer,
      "updated_at" timestamp DEFAULT now()
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "business_api_send_log" (
      "id" bigserial PRIMARY KEY NOT NULL,
      "business_id" integer NOT NULL,
      "api_key_id" integer,
      "endpoint" text NOT NULL,
      "kind" text,
      "http_status" integer NOT NULL,
      "code" text,
      "charged_paise" integer NOT NULL DEFAULT 0,
      "created_at" timestamp DEFAULT now()
    )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "business_api_send_log_business_idx" ON "business_api_send_log" ("business_id", "created_at")`);
}

export type AutomationControls = { botsPaused: boolean; apiPaused: boolean; reason: string | null; updatedAt: Date | null };
// No in-memory cache: production runs several servers, and a pause must apply on all of them at once.
// It's a primary-key lookup, cheap enough for every bot run and API call.
export async function getAutomationControls(businessId: number): Promise<AutomationControls> {
  const [r] = rows<{ bots_paused: boolean; api_paused: boolean; reason: string | null; updated_at: Date | null }>(await db.execute(sql`
    SELECT bots_paused, api_paused, reason, updated_at FROM business_automation_controls WHERE business_id = ${businessId}`));
  return { botsPaused: r?.bots_paused ?? false, apiPaused: r?.api_paused ?? false, reason: r?.reason ?? null, updatedAt: r?.updated_at ?? null };
}

/** After API-key auth: refuse when NeuraTalk paused this company's API sending. */
export async function apiNotPaused(req: Request, res: Response, next: NextFunction) {
  const businessId = (req as unknown as { apiKey?: { organizationId: number } }).apiKey?.organizationId;
  if (!businessId) return next();
  try {
    const c = await getAutomationControls(businessId);
    if (c.apiPaused) {
      return res.status(403).json({ success: false, status: "failed", code: "PAUSED_BY_NEURATALK", error: `NeuraTalk paused API sending for this business.${c.reason ? " Reason: " + c.reason : ""} Contact support.` });
    }
  } catch (error) {
    logger.warn("AutomationAdmin", `control check failed: ${String(error)}`);
  }
  next();
}

/** After API-key auth: record the outcome of every API call (no message text, no phone). */
export function recordApiUse(req: Request, res: Response, next: NextFunction) {
  const apiKey = (req as unknown as { apiKey?: { id?: number; organizationId: number } }).apiKey;
  if (!apiKey) return next();
  let body: Record<string, unknown> | null = null;
  const json = res.json.bind(res);
  res.json = ((b: unknown) => { body = (b && typeof b === "object") ? b as Record<string, unknown> : null; return json(b); }) as typeof res.json;
  res.on("finish", () => {
    const b = body as { code?: unknown; type?: unknown; chargedPaise?: unknown; message?: { type?: unknown; chargedPaise?: unknown } } | null;
    const kind = String(b?.type ?? b?.message?.type ?? (req.path.includes("otp") ? "code" : req.path.includes("utility") ? "utility" : "")) || null;
    const charged = Number(b?.chargedPaise ?? b?.message?.chargedPaise ?? 0) || 0;
    db.execute(sql`
      INSERT INTO business_api_send_log (business_id, api_key_id, endpoint, kind, http_status, code, charged_paise)
      VALUES (${apiKey.organizationId}, ${apiKey.id ?? null}, ${(req.baseUrl + req.path).slice(0, 120)}, ${kind}, ${res.statusCode},
        ${typeof b?.code === "string" ? b.code.slice(0, 60) : null}, ${charged})`)
      .catch((error) => logger.warn("AutomationAdmin", `usage log failed: ${String(error)}`));
  });
  next();
}

const controlsSchema = z.object({
  botsPaused: z.boolean(),
  apiPaused: z.boolean(),
  reason: z.string().trim().max(300).optional().default(""),
}).refine((v) => !(v.botsPaused || v.apiPaused) || v.reason.length >= 5, { message: "Write the reason (the company sees it)." });

export function registerAutomationAdminRoutes(app: Express): void {
  const admin = [requireAuth, requireRole("super_admin")];

  app.get("/api/admin/business-automation", ...admin, async (_req: Request, res: Response) => {
    const list = rows<Record<string, unknown>>(await db.execute(sql`
      SELECT o.id, o.name,
        (SELECT count(*)::int FROM business_auto_responders r WHERE r.business_id = o.id) AS bots,
        (SELECT count(*)::int FROM business_auto_responders r WHERE r.business_id = o.id AND r.is_active) AS bots_active,
        (SELECT count(*)::int FROM business_auto_responder_runs x WHERE x.business_id = o.id AND x.created_at > now() - interval '7 days') AS bot_replies_7d,
        (SELECT count(*)::int FROM business_api_send_log l WHERE l.business_id = o.id AND l.created_at > now() - interval '7 days') AS api_calls_7d,
        (SELECT count(*)::int FROM business_api_send_log l WHERE l.business_id = o.id AND l.created_at > now() - interval '7 days' AND l.http_status >= 400) AS api_failed_7d,
        (SELECT coalesce(sum(charged_paise), 0)::int FROM business_api_send_log l WHERE l.business_id = o.id AND l.created_at > now() - interval '7 days') AS api_paise_7d,
        (SELECT max(created_at) FROM business_api_send_log l WHERE l.business_id = o.id) AS api_last_used,
        coalesce(c.bots_paused, false) AS bots_paused, coalesce(c.api_paused, false) AS api_paused, c.reason
      FROM organizations o
      LEFT JOIN business_automation_controls c ON c.business_id = o.id
      ORDER BY (SELECT count(*) FROM business_api_send_log l WHERE l.business_id = o.id AND l.created_at > now() - interval '7 days') DESC, o.id ASC
      LIMIT 500`));
    res.json({
      success: true,
      companies: list.map((r) => ({
        id: r.id, name: r.name, bots: r.bots, botsActive: r.bots_active, botReplies7d: r.bot_replies_7d,
        apiCalls7d: r.api_calls_7d, apiFailed7d: r.api_failed_7d, apiPaise7d: r.api_paise_7d, apiLastUsed: r.api_last_used,
        botsPaused: r.bots_paused, apiPaused: r.api_paused, reason: r.reason,
      })),
    });
  });

  app.get("/api/admin/business-automation/:orgId", ...admin, async (req: Request, res: Response) => {
    const orgId = Number(req.params.orgId);
    if (!Number.isSafeInteger(orgId) || orgId <= 0) return res.status(400).json({ success: false, error: "Invalid id." });
    const bots = rows<Record<string, unknown>>(await db.execute(sql`
      SELECT r.id, r.name, r.trigger_type, r.keywords, r.reply_text, r.buttons, r.is_active, r.cooldown_seconds,
        (SELECT count(*)::int FROM business_auto_responder_runs x WHERE x.responder_id = r.id) AS hits
      FROM business_auto_responders r WHERE r.business_id = ${orgId} ORDER BY r.priority DESC, r.id`));
    const calls = rows<Record<string, unknown>>(await db.execute(sql`
      SELECT id, api_key_id, endpoint, kind, http_status, code, charged_paise, created_at
      FROM business_api_send_log WHERE business_id = ${orgId} ORDER BY created_at DESC LIMIT 50`));
    const errors = rows<{ code: string | null; http_status: number; n: number }>(await db.execute(sql`
      SELECT code, http_status, count(*)::int AS n FROM business_api_send_log
      WHERE business_id = ${orgId} AND http_status >= 400 AND created_at > now() - interval '7 days'
      GROUP BY code, http_status ORDER BY n DESC LIMIT 10`));
    res.json({
      success: true,
      controls: await getAutomationControls(orgId),
      bots: bots.map((b) => ({ id: b.id, name: b.name, triggerType: b.trigger_type, keywords: b.keywords, replyText: b.reply_text, buttons: b.buttons, isActive: b.is_active, cooldownSeconds: b.cooldown_seconds, hits: b.hits })),
      apiCalls: calls.map((c) => ({ id: Number(c.id), apiKeyId: c.api_key_id, endpoint: c.endpoint, kind: c.kind, httpStatus: c.http_status, code: c.code, chargedPaise: c.charged_paise, createdAt: c.created_at })),
      apiErrors7d: errors.map((e) => ({ code: e.code ?? `HTTP_${e.http_status}`, count: e.n })),
    });
  });

  app.put("/api/admin/business-automation/:orgId/controls", ...admin, async (req: Request, res: Response) => {
    const orgId = Number(req.params.orgId);
    if (!Number.isSafeInteger(orgId) || orgId <= 0) return res.status(400).json({ success: false, error: "Invalid id." });
    const parsed = controlsSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? "Check the form." });
    const found = rows<{ id: number }>(await db.execute(sql`SELECT id FROM organizations WHERE id = ${orgId}`));
    if (!found.length) return res.status(404).json({ success: false, error: "Company not found." });
    const before = await getAutomationControls(orgId);
    const d = parsed.data;
    const reason = d.botsPaused || d.apiPaused ? d.reason : null;
    await db.execute(sql`
      INSERT INTO business_automation_controls (business_id, bots_paused, api_paused, reason, updated_by, updated_at)
      VALUES (${orgId}, ${d.botsPaused}, ${d.apiPaused}, ${reason}, ${req.user!.id}, now())
      ON CONFLICT (business_id) DO UPDATE SET bots_paused = EXCLUDED.bots_paused, api_paused = EXCLUDED.api_paused,
        reason = EXCLUDED.reason, updated_by = EXCLUDED.updated_by, updated_at = now()`);
    await createAuditLog({
      userId: req.user!.id, organizationId: orgId,
      action: (d.botsPaused || d.apiPaused ? AUDIT_ACTION.SUSPEND : AUDIT_ACTION.SETTINGS_CHANGE) as never,
      entityType: "business_automation", entityId: orgId,
      oldValue: { botsPaused: before.botsPaused, apiPaused: before.apiPaused },
      newValue: { botsPaused: d.botsPaused, apiPaused: d.apiPaused, reason },
    });
    res.json({ success: true, controls: await getAutomationControls(orgId) });
  });
}
