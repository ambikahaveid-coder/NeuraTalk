/**
 * Business forms (like WhatsApp Flows): a business builds a short form
 * (booking, enquiry, feedback…), sends it in a chat, the customer fills it
 * in inside the chat, and the answers land with the business (list + CSV).
 */
import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { businessConversations, customers, messagingMessages, PERMISSIONS } from "@shared/schema";
import { requireAuth, requireCompanyAccess, requirePermission } from "../../role-middleware";
import { logger } from "../../observability";
import { sendBusinessAgentMessage, sendUserInitiatedMessage } from "./service";

const rows = <T>(r: unknown) => (r as { rows: T[] }).rows;

export async function ensureFormsTables(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "business_forms" (
      "id" serial PRIMARY KEY NOT NULL,
      "business_id" integer NOT NULL,
      "name" text NOT NULL,
      "title" text NOT NULL,
      "intro" text,
      "fields" jsonb NOT NULL,
      "is_active" boolean NOT NULL DEFAULT true,
      "created_by" integer,
      "created_at" timestamp DEFAULT now(),
      "updated_at" timestamp DEFAULT now()
    )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "business_forms_business_idx" ON "business_forms" ("business_id")`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "business_form_responses" (
      "id" serial PRIMARY KEY NOT NULL,
      "form_id" integer NOT NULL REFERENCES "business_forms"("id") ON DELETE CASCADE,
      "business_id" integer NOT NULL,
      "form_message_id" integer NOT NULL,
      "customer_user_id" integer NOT NULL,
      "business_conversation_id" integer,
      "answers" jsonb NOT NULL,
      "created_at" timestamp DEFAULT now()
    )`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "business_form_responses_once" ON "business_form_responses" ("form_message_id", "customer_user_id")`);
}

const FIELD_TYPES = ["text", "long_text", "number", "date", "choice", "phone", "email"] as const;
const fieldSchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9_]{1,30}$/, "Field ids use a-z, 0-9 and _"),
  label: z.string().trim().min(1).max(80),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().optional(),
  options: z.array(z.string().trim().min(1).max(60)).max(12).optional(),
}).refine((f) => f.type !== "choice" || (f.options && f.options.length >= 2), { message: "A choice field needs at least 2 options." });

const formSchema = z.object({
  name: z.string().trim().min(2).max(60),
  title: z.string().trim().min(2).max(80),
  intro: z.string().trim().max(300).optional(),
  fields: z.array(fieldSchema).min(1).max(15)
    .refine((f) => new Set(f.map((x) => x.id)).size === f.length, "Each field needs its own id."),
});

type Field = z.infer<typeof fieldSchema>;
type FormRow = { id: number; business_id: number; name: string; title: string; intro: string | null; fields: Field[]; is_active: boolean; created_at: Date };

const present = (f: FormRow, responses?: number) => ({
  id: f.id, name: f.name, title: f.title, intro: f.intro, fields: f.fields, createdAt: f.created_at, ...(responses !== undefined ? { responses } : {}),
});

function validIds(req: Request, res: Response, next: NextFunction) {
  for (const key of ["businessId", "formId", "conversationId", "messageId"]) {
    const v = req.params[key];
    if (v !== undefined && !(Number.isSafeInteger(Number(v)) && Number(v) > 0)) return res.status(400).json({ success: false, error: "Invalid id." });
  }
  next();
}

/** Checks one answer against its field; returns the clean value or an error message. */
function checkAnswer(field: Field, raw: unknown): { value: string | null } | { error: string } {
  const v = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  if (!v) return field.required ? { error: `"${field.label}" is required.` } : { value: null };
  if (v.length > (field.type === "long_text" ? 2000 : 200)) return { error: `"${field.label}" is too long.` };
  switch (field.type) {
    case "number":
      return /^-?\d+(\.\d+)?$/.test(v) ? { value: v } : { error: `"${field.label}" must be a number.` };
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(v).getTime()) ? { value: v } : { error: `"${field.label}" must be a date.` };
    case "choice":
      return field.options?.includes(v) ? { value: v } : { error: `Pick one of the options for "${field.label}".` };
    case "phone":
      return v.replace(/\D/g, "").length >= 10 && v.replace(/\D/g, "").length <= 15 ? { value: v } : { error: `"${field.label}" must be a phone number.` };
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? { value: v } : { error: `"${field.label}" must be an email address.` };
    default:
      return { value: v };
  }
}

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  // Neutralise spreadsheet formulas and quote everything.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

export function registerFormRoutes(app: Express): void {
  const team = [requireAuth, validIds, requireCompanyAccess("businessId"), requirePermission(PERMISSIONS.MESSAGING_SEND)];

  app.get("/api/business/:businessId/forms", ...team, async (req: Request, res: Response) => {
    const list = rows<FormRow & { responses: number }>(await db.execute(sql`
      SELECT f.*, (SELECT count(*)::int FROM business_form_responses r WHERE r.form_id = f.id) AS responses
      FROM business_forms f WHERE f.business_id = ${Number(req.params.businessId)} AND f.is_active ORDER BY f.created_at DESC`));
    res.json({ success: true, forms: list.map((f) => present(f, f.responses)) });
  });

  app.post("/api/business/:businessId/forms", ...team, async (req: Request, res: Response) => {
    const parsed = formSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? "Check the form." });
    const businessId = Number(req.params.businessId);
    const [{ n }] = rows<{ n: number }>(await db.execute(sql`SELECT count(*)::int AS n FROM business_forms WHERE business_id = ${businessId} AND is_active`));
    if (n >= 50) return res.status(400).json({ success: false, error: "You can keep up to 50 forms." });
    const [f] = rows<FormRow>(await db.execute(sql`
      INSERT INTO business_forms (business_id, name, title, intro, fields, created_by)
      VALUES (${businessId}, ${parsed.data.name}, ${parsed.data.title}, ${parsed.data.intro ?? null}, ${JSON.stringify(parsed.data.fields)}::jsonb, ${req.user!.id})
      RETURNING *`));
    res.status(201).json({ success: true, form: present(f, 0) });
  });

  app.put("/api/business/:businessId/forms/:formId", ...team, async (req: Request, res: Response) => {
    const parsed = formSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? "Check the form." });
    const updated = rows<FormRow>(await db.execute(sql`
      UPDATE business_forms SET name = ${parsed.data.name}, title = ${parsed.data.title}, intro = ${parsed.data.intro ?? null},
        fields = ${JSON.stringify(parsed.data.fields)}::jsonb, updated_at = now()
      WHERE id = ${Number(req.params.formId)} AND business_id = ${Number(req.params.businessId)} AND is_active RETURNING *`));
    if (!updated.length) return res.status(404).json({ success: false, error: "Form not found." });
    res.json({ success: true, form: present(updated[0]) });
  });

  app.delete("/api/business/:businessId/forms/:formId", ...team, async (req: Request, res: Response) => {
    // Archived, not deleted: answers already given stay readable.
    await db.execute(sql`UPDATE business_forms SET is_active = false WHERE id = ${Number(req.params.formId)} AND business_id = ${Number(req.params.businessId)}`);
    res.json({ success: true });
  });

  /** Send a form in a chat (normal 24-hour rule applies). */
  app.post("/api/business/:businessId/conversations/:conversationId/form", ...team, async (req: Request, res: Response) => {
    const parsed = z.object({ formId: z.number().int().positive() }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ success: false, error: "Pick a form." });
    const businessId = Number(req.params.businessId);
    const [f] = rows<FormRow>(await db.execute(sql`SELECT * FROM business_forms WHERE id = ${parsed.data.formId} AND business_id = ${businessId} AND is_active`));
    if (!f) return res.status(404).json({ success: false, error: "Form not found." });
    try {
      const result = await sendBusinessAgentMessage({
        businessId,
        businessConversationId: Number(req.params.conversationId),
        authenticatedUserId: req.user!.id,
        content: `📝 ${f.title}`,
        messageType: "form",
        extraMetadata: { form: { id: f.id, title: f.title, intro: f.intro, fields: f.fields } },
      });
      res.status(201).json({ success: true, messageId: result.message.id });
    } catch (error) {
      if ((error as Error)?.name === "ServiceWindowClosedError") {
        return res.status(409).json({ success: false, code: "SERVICE_WINDOW_CLOSED", error: (error as Error).message });
      }
      if ((error as Error)?.name === "NotFoundError") return res.status(404).json({ success: false, error: "Conversation not found" });
      logger.error("Forms", "Could not send form", error as Error);
      res.status(500).json({ success: false, error: "Could not send the form." });
    }
  });

  app.get("/api/business/:businessId/forms/:formId/responses", ...team, async (req: Request, res: Response) => {
    const [owned] = rows<{ id: number }>(await db.execute(sql`SELECT id FROM business_forms WHERE id = ${Number(req.params.formId)} AND business_id = ${Number(req.params.businessId)}`));
    if (!owned) return res.status(404).json({ success: false, error: "Form not found." });
    const list = rows<{ id: number; answers: unknown; created_at: Date; customer_name: string | null; customer_id: number | null }>(await db.execute(sql`
      SELECT r.id, r.answers, r.created_at, c.name AS customer_name, c.id AS customer_id
      FROM business_form_responses r
      LEFT JOIN customers c ON c.business_id = r.business_id AND c.linked_user_id = r.customer_user_id
      WHERE r.form_id = ${Number(req.params.formId)} AND r.business_id = ${Number(req.params.businessId)}
      ORDER BY r.created_at DESC LIMIT 1000`));
    res.json({ success: true, responses: list.map((r) => ({ id: r.id, answers: r.answers, createdAt: r.created_at, customerName: r.customer_name, customerId: r.customer_id })) });
  });

  app.get("/api/business/:businessId/forms/:formId/responses.csv", ...team, async (req: Request, res: Response) => {
    const businessId = Number(req.params.businessId);
    const [f] = rows<FormRow>(await db.execute(sql`SELECT * FROM business_forms WHERE id = ${Number(req.params.formId)} AND business_id = ${businessId}`));
    if (!f) return res.status(404).json({ success: false, error: "Form not found." });
    const list = rows<{ answers: Array<{ id: string; value: string | null }>; created_at: Date; customer_name: string | null }>(await db.execute(sql`
      SELECT r.answers, r.created_at, c.name AS customer_name FROM business_form_responses r
      LEFT JOIN customers c ON c.business_id = r.business_id AND c.linked_user_id = r.customer_user_id
      WHERE r.form_id = ${f.id} ORDER BY r.created_at`));
    const header = ["Submitted at", "Customer", ...f.fields.map((x) => x.label)].map(csvCell).join(",");
    const lines = list.map((r) => [
      new Date(r.created_at).toISOString(), r.customer_name ?? "",
      ...f.fields.map((x) => (Array.isArray(r.answers) ? r.answers.find((a) => a.id === x.id)?.value : "") ?? ""),
    ].map(csvCell).join(","));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${f.name.replace(/[^\w-]+/g, "_")}-responses.csv"`);
    res.send("﻿" + [header, ...lines].join("\r\n"));
  });

  /** Customer fills in a form they received. Once per form message. */
  app.post("/api/messaging/business/:businessId/forms/:messageId/submit", requireAuth, validIds, async (req: Request, res: Response) => {
    const businessId = Number(req.params.businessId);
    const messageId = Number(req.params.messageId);
    const userId = req.user!.id;
    const answersIn = (req.body?.answers ?? {}) as Record<string, unknown>;
    if (typeof answersIn !== "object" || Array.isArray(answersIn)) return res.status(400).json({ success: false, error: "Invalid answers." });
    // The form message must be in this customer's own chat with this business.
    const [conv] = await db.select({ id: businessConversations.id, conversationId: businessConversations.conversationId })
      .from(businessConversations).innerJoin(customers, eq(customers.id, businessConversations.customerId))
      .where(and(eq(businessConversations.businessId, businessId), eq(customers.linkedUserId, userId))).limit(1);
    const [msg] = conv
      ? await db.select().from(messagingMessages).where(and(eq(messagingMessages.id, messageId), eq(messagingMessages.conversationId, conv.conversationId)))
      : [];
    const form = (msg?.metadata as { form?: { id: number; title: string; fields: Field[] } } | null)?.form;
    if (!msg || msg.messageType !== "form" || !form) return res.status(404).json({ success: false, error: "Form not found." });
    const answers: Array<{ id: string; label: string; value: string | null }> = [];
    for (const field of form.fields) {
      const checked = checkAnswer(field, answersIn[field.id]);
      if ("error" in checked) return res.status(400).json({ success: false, error: checked.error, field: field.id });
      answers.push({ id: field.id, label: field.label, value: checked.value });
    }
    const inserted = rows<{ id: number }>(await db.execute(sql`
      INSERT INTO business_form_responses (form_id, business_id, form_message_id, customer_user_id, business_conversation_id, answers)
      VALUES (${form.id}, ${businessId}, ${messageId}, ${userId}, ${conv!.id}, ${JSON.stringify(answers)}::jsonb)
      ON CONFLICT DO NOTHING RETURNING id`));
    if (!inserted.length) return res.status(409).json({ success: false, error: "You already sent this form." });
    try {
      const summary = [`📝 ${form.title}`, ...answers.filter((a) => a.value).map((a) => `${a.label}: ${a.value}`)].join("\n");
      const sent = await sendUserInitiatedMessage({
        businessId, authenticatedUserId: userId, content: summary.slice(0, 8000), messageType: "form_response",
        replyToMessageId: messageId,
        extraMetadata: { formResponse: { formMessageId: messageId, formId: form.id, title: form.title, answers } },
      });
      res.status(201).json({ success: true, responseId: inserted[0].id, messageId: sent.message.id });
    } catch (err) {
      // Keep it all-or-nothing for the customer: without the chat message the answer is removed.
      await db.execute(sql`DELETE FROM business_form_responses WHERE id = ${inserted[0].id}`).catch(() => undefined);
      if ((err as Error)?.name === "BusinessBlockedError") return res.status(409).json({ success: false, error: "You blocked this business. Unblock it first." });
      logger.error("Forms", "Could not submit form", err as Error);
      res.status(500).json({ success: false, error: "Could not send. Try again." });
    }
  });
}
