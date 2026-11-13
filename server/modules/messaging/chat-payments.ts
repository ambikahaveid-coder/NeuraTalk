/**
 * Payments in the business chat (UPI payment requests).
 *
 * The business saves its own UPI ID, then sends a payment request in the
 * chat (optionally for an order). The customer taps "Pay" and their own UPI
 * app opens with the amount filled in; the money goes straight from the
 * customer's bank to the business's bank. NeuraTalk never holds or moves the
 * money and never sees bank details beyond the business's public UPI ID.
 *
 * Because UPI apps don't report back to us, the customer taps "I've paid"
 * (with the UTR if they have it) and the business confirms it once the money
 * shows in its own bank or UPI app. Every step is a message in the chat.
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { businessConversations, customers, messagingMessages, organizations, PERMISSIONS } from "@shared/schema";
import { requireAuth, requireCompanyAccess, requirePermission } from "../../role-middleware";
import { sendBusinessAgentMessage, sendUserInitiatedMessage, BusinessBlockedError } from "./service";
import { logger } from "../../observability";

export const PAYMENT_STATUSES = ["requested", "customer_paid", "paid", "cancelled"] as const;
type PaymentStatus = typeof PAYMENT_STATUSES[number];
export const MAX_REQUEST_PAISE = 1_00_000_00; // ₹1,00,000: the usual UPI limit per payment

export async function ensureChatPaymentTables(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "business_payment_settings" (
      "business_id" integer PRIMARY KEY REFERENCES "organizations"("id") ON DELETE CASCADE,
      "upi_id" text NOT NULL,
      "payee_name" text NOT NULL,
      "updated_by" integer,
      "updated_at" timestamp NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "business_payment_requests" (
      "id" serial PRIMARY KEY,
      "business_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "business_conversation_id" integer NOT NULL,
      "customer_user_id" integer,
      "order_id" integer,
      "message_id" integer,
      "amount_paise" integer NOT NULL,
      "note" text,
      "upi_id" text NOT NULL,
      "payee_name" text NOT NULL,
      "status" text NOT NULL DEFAULT 'requested',
      "customer_reference" text,
      "created_by" integer,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "customer_paid_at" timestamp,
      "settled_at" timestamp
    )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "business_payment_requests_biz" ON "business_payment_requests" ("business_id", "created_at")`);
}

interface PaymentRow {
  id: number; business_id: number; business_conversation_id: number; customer_user_id: number | null; order_id: number | null;
  message_id: number | null; amount_paise: number; note: string | null; upi_id: string; payee_name: string; status: PaymentStatus;
  customer_reference: string | null; created_at: Date; customer_paid_at: Date | null; settled_at: Date | null;
}
const rows = <T>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? []) as T[];

export function rupees(paise: number): string {
  const r = paise / 100;
  return `₹${Number.isInteger(r) ? r.toLocaleString("en-IN") : r.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** The standard UPI link every UPI app understands (NPCI "upi://pay"). */
export function upiLink(p: { upiId: string; payeeName: string; amountPaise: number; note?: string | null; reference: string }): string {
  const q = new URLSearchParams({
    pa: p.upiId, pn: p.payeeName, am: (p.amountPaise / 100).toFixed(2), cu: "INR", tr: p.reference,
    ...(p.note ? { tn: p.note.slice(0, 50) } : {}),
  });
  return `upi://pay?${q.toString()}`;
}

const reference = (id: number) => `NT${id}`;

/** What the chat card shows; kept on the message and refreshed on each step. */
function paymentMeta(p: PaymentRow) {
  return {
    payment: {
      requestId: p.id, amountPaise: p.amount_paise, note: p.note, orderId: p.order_id,
      upiId: p.upi_id, payeeName: p.payee_name, status: p.status, reference: reference(p.id),
      upiLink: upiLink({ upiId: p.upi_id, payeeName: p.payee_name, amountPaise: p.amount_paise, note: p.note, reference: reference(p.id) }),
    },
  };
}

async function refreshCard(p: PaymentRow) {
  if (!p.message_id) return;
  await db.update(messagingMessages)
    .set({ metadata: sql`coalesce(${messagingMessages.metadata}, '{}'::jsonb) || ${JSON.stringify(paymentMeta(p))}::jsonb` })
    .where(eq(messagingMessages.id, p.message_id));
}

function present(p: PaymentRow, customerName?: string | null) {
  return {
    id: p.id, conversationId: p.business_conversation_id, orderId: p.order_id, messageId: p.message_id,
    amountPaise: p.amount_paise, note: p.note, upiId: p.upi_id, status: p.status, reference: reference(p.id),
    customerReference: p.customer_reference, customerName: customerName ?? null,
    createdAt: p.created_at, customerPaidAt: p.customer_paid_at, settledAt: p.settled_at,
  };
}

const settingsSchema = z.object({
  // name@bank: letters, digits, dot, dash, underscore before @, letters after.
  upiId: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{2,256}@[a-z][a-z0-9.-]{1,63}$/, "Enter a UPI ID like shopname@okaxis"),
  payeeName: z.string().trim().min(2).max(60),
});

const requestSchema = z.object({
  amountPaise: z.number().int().min(100, "The smallest request is ₹1").max(MAX_REQUEST_PAISE, "The most you can request at once is ₹1,00,000"),
  note: z.string().trim().max(80).optional(),
  orderId: z.number().int().positive().optional(),
});

async function settingsOf(businessId: number): Promise<{ upiId: string; payeeName: string } | null> {
  const r = rows<{ upi_id: string; payee_name: string }>(await db.execute(sql`SELECT upi_id, payee_name FROM business_payment_settings WHERE business_id = ${businessId}`))[0];
  return r ? { upiId: r.upi_id, payeeName: r.payee_name } : null;
}

export function registerChatPaymentRoutes(app: Express): void {
  const view = [requireAuth, requireCompanyAccess("businessId"), requirePermission(PERMISSIONS.MESSAGING_VIEW)];
  const send = [requireAuth, requireCompanyAccess("businessId"), requirePermission(PERMISSIONS.MESSAGING_SEND)];

  // ---------------------------------------------------------------- business
  app.get("/api/business/:businessId/payment-settings", ...view, async (req: Request, res: Response) => {
    res.json({ success: true, settings: await settingsOf(Number(req.params.businessId)) });
  });

  app.put("/api/business/:businessId/payment-settings", ...send, async (req: Request, res: Response) => {
    const parsed = settingsSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? "Check the UPI ID." });
    const businessId = Number(req.params.businessId);
    await db.execute(sql`
      INSERT INTO business_payment_settings (business_id, upi_id, payee_name, updated_by) VALUES (${businessId}, ${parsed.data.upiId}, ${parsed.data.payeeName}, ${req.user!.id})
      ON CONFLICT (business_id) DO UPDATE SET upi_id = EXCLUDED.upi_id, payee_name = EXCLUDED.payee_name, updated_by = EXCLUDED.updated_by, updated_at = now()`);
    res.json({ success: true, settings: parsed.data });
  });

  app.get("/api/business/:businessId/payment-requests", ...view, async (req: Request, res: Response) => {
    const businessId = Number(req.params.businessId);
    const status = String(req.query.status ?? "");
    const filter = (PAYMENT_STATUSES as readonly string[]).includes(status) ? sql`AND p.status = ${status}` : sql``;
    const list = rows<PaymentRow & { customer_name: string | null }>(await db.execute(sql`
      SELECT p.*, coalesce(nullif(trim(u.display_name), ''), u.username, c.name, c.phone) AS customer_name
      FROM business_payment_requests p
      LEFT JOIN users u ON u.id = p.customer_user_id
      LEFT JOIN business_conversations bc ON bc.id = p.business_conversation_id
      LEFT JOIN customers c ON c.id = bc.customer_id
      WHERE p.business_id = ${businessId} ${filter}
      ORDER BY p.created_at DESC LIMIT 200`));
    const totals = rows<{ status: string; n: number; paise: number }>(await db.execute(sql`
      SELECT status, count(*)::int AS n, coalesce(sum(amount_paise), 0)::bigint AS paise FROM business_payment_requests WHERE business_id = ${businessId} GROUP BY status`));
    res.json({
      success: true,
      requests: list.map((p) => present(p, p.customer_name)),
      totals: Object.fromEntries(totals.map((t) => [t.status, { count: Number(t.n), amountPaise: Number(t.paise) }])),
    });
  });

  // Send a payment request in a chat (24-hour rule, like any business message).
  app.post("/api/business/:businessId/conversations/:conversationId/payment-request", ...send, async (req: Request, res: Response) => {
    const businessId = Number(req.params.businessId);
    const conversationId = Number(req.params.conversationId);
    const parsed = requestSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? "Enter the amount." });
    const settings = await settingsOf(businessId);
    if (!settings) return res.status(400).json({ success: false, code: "NO_UPI_ID", error: "Add your UPI ID first (Payments settings)." });
    const [conv] = await db.select({ id: businessConversations.id, customerId: businessConversations.customerId }).from(businessConversations)
      .where(and(eq(businessConversations.id, conversationId), eq(businessConversations.businessId, businessId)));
    if (!conv) return res.status(404).json({ success: false, error: "Conversation not found" });
    const [cust] = conv.customerId ? await db.select({ linkedUserId: customers.linkedUserId }).from(customers).where(eq(customers.id, conv.customerId)) : [];
    if (parsed.data.orderId) {
      const order = rows<{ id: number }>(await db.execute(sql`SELECT id FROM business_orders WHERE id = ${parsed.data.orderId} AND business_id = ${businessId} AND business_conversation_id = ${conversationId}`))[0];
      if (!order) return res.status(400).json({ success: false, error: "That order isn't in this chat." });
    }
    const created = rows<PaymentRow>(await db.execute(sql`
      INSERT INTO business_payment_requests (business_id, business_conversation_id, customer_user_id, order_id, amount_paise, note, upi_id, payee_name, created_by)
      VALUES (${businessId}, ${conversationId}, ${cust?.linkedUserId ?? null}, ${parsed.data.orderId ?? null}, ${parsed.data.amountPaise}, ${parsed.data.note ?? null},
              ${settings.upiId}, ${settings.payeeName}, ${req.user!.id})
      RETURNING *`))[0];
    try {
      const text = `💳 Payment request: ${rupees(created.amount_paise)}${created.note ? ` for ${created.note}` : ""}${created.order_id ? ` (order #${created.order_id})` : ""}`;
      const sent = await sendBusinessAgentMessage({
        businessId, businessConversationId: conversationId, authenticatedUserId: req.user!.id,
        content: text, messageType: "payment_request", extraMetadata: paymentMeta(created),
      } as Parameters<typeof sendBusinessAgentMessage>[0]);
      await db.execute(sql`UPDATE business_payment_requests SET message_id = ${sent.message.id} WHERE id = ${created.id}`);
      res.status(201).json({ success: true, request: present({ ...created, message_id: sent.message.id }), message: sent.message });
    } catch (error) {
      await db.execute(sql`DELETE FROM business_payment_requests WHERE id = ${created.id}`);
      const name = (error as Error)?.name;
      if (name === "ServiceWindowClosedError") return res.status(409).json({ success: false, code: "SERVICE_WINDOW_CLOSED", error: "The customer hasn't written in the last 24 hours. Send an approved template instead." });
      if (name === "NotYourAssignmentError") return res.status(403).json({ success: false, error: "This conversation is assigned to someone else" });
      logger.error("Payments", "Payment request not sent", error as Error);
      res.status(500).json({ success: false, error: "Could not send the payment request." });
    }
  });

  // Business: the money arrived (paid) or the request is withdrawn (cancelled).
  app.patch("/api/business/:businessId/payment-requests/:requestId", ...send, async (req: Request, res: Response) => {
    const businessId = Number(req.params.businessId);
    const parsed = z.object({ status: z.enum(["paid", "cancelled"]) }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ success: false, error: "Pick paid or cancelled." });
    const updated = rows<PaymentRow>(await db.execute(sql`
      UPDATE business_payment_requests SET status = ${parsed.data.status}, settled_at = now()
      WHERE id = ${Number(req.params.requestId)} AND business_id = ${businessId} AND status IN ('requested', 'customer_paid')
      RETURNING *`))[0];
    if (!updated) {
      const current = rows<{ status: string }>(await db.execute(sql`SELECT status FROM business_payment_requests WHERE id = ${Number(req.params.requestId)} AND business_id = ${businessId}`))[0];
      if (!current) return res.status(404).json({ success: false, error: "Payment request not found." });
      return res.status(409).json({ success: false, error: `This request is already ${current.status === "paid" ? "paid" : "cancelled"}.` });
    }
    await refreshCard(updated);
    const text = parsed.data.status === "paid"
      ? `✅ Payment of ${rupees(updated.amount_paise)} received. Thank you!`
      : `Payment request of ${rupees(updated.amount_paise)} cancelled.`;
    try {
      await sendBusinessAgentMessage({ businessId, businessConversationId: updated.business_conversation_id, authenticatedUserId: req.user!.id, content: text, systemUpdate: true });
    } catch (err) { logger.warn("Payments", "Status message not sent", { error: (err as Error).message }); }
    res.json({ success: true, request: present(updated) });
  });

  // ---------------------------------------------------------------- customer
  // "I've paid": tells the business to check its bank. Optional UTR / reference.
  app.post("/api/messaging/business/:businessId/payment-requests/:requestId/paid", requireAuth, async (req: Request, res: Response) => {
    const businessId = Number(req.params.businessId);
    const requestId = Number(req.params.requestId);
    if (!Number.isInteger(businessId) || !Number.isInteger(requestId)) return res.status(400).json({ success: false, error: "Invalid request" });
    const parsed = z.object({ reference: z.string().trim().regex(/^[A-Za-z0-9]{6,30}$/, "The UTR is 12 digits, shown in your UPI app after paying").optional() }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.issues[0]?.message });
    const [org] = await db.select({ isActive: organizations.isActive }).from(organizations).where(eq(organizations.id, businessId));
    if (!org) return res.status(404).json({ success: false, error: "Business not found" });
    const updated = rows<PaymentRow>(await db.execute(sql`
      UPDATE business_payment_requests SET status = 'customer_paid', customer_paid_at = now(), customer_reference = ${parsed.data.reference ?? null}
      WHERE id = ${requestId} AND business_id = ${businessId} AND customer_user_id = ${req.user!.id} AND status = 'requested'
      RETURNING *`))[0];
    if (!updated) {
      const current = rows<{ status: string; customer_user_id: number | null }>(await db.execute(sql`SELECT status, customer_user_id FROM business_payment_requests WHERE id = ${requestId} AND business_id = ${businessId}`))[0];
      if (!current || current.customer_user_id !== req.user!.id) return res.status(404).json({ success: false, error: "Payment request not found." });
      return res.status(409).json({ success: false, error: current.status === "customer_paid" ? "You already told the business you paid." : `This request is ${current.status}.` });
    }
    await refreshCard(updated);
    try {
      await sendUserInitiatedMessage({
        businessId, authenticatedUserId: req.user!.id,
        content: `💸 I've paid ${rupees(updated.amount_paise)} by UPI${updated.customer_reference ? ` (UTR ${updated.customer_reference})` : ""}.`,
      });
    } catch (err) {
      if (err instanceof BusinessBlockedError) return res.status(409).json({ success: false, error: "You blocked this business. Unblock it first." });
      logger.warn("Payments", "Paid message not sent", { error: (err as Error).message });
    }
    res.json({ success: true, request: present(updated) });
  });
}
