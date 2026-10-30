/**
 * Orders from the business chat: the customer picks catalog items and
 * quantities and sends an order; it appears in the chat as a message and
 * in the business's Orders list. The business moves it along
 * (accepted -> ready -> delivered, or cancelled) and each step is posted in
 * the same chat, so the customer is notified like any other message.
 *
 * Prices always come from the business's catalog on the server, never from
 * the app. There is no online payment here: the customer pays the business
 * directly (cash/UPI on delivery), the way most small shops work.
 */
import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import { businessCatalogItems, businessConversations, customers, organizations, PERMISSIONS } from "@shared/schema";
import { requireAuth, requireCompanyAccess, requirePermission } from "../../role-middleware";
import { sendUserInitiatedMessage, sendBusinessAgentMessage, BusinessBlockedError } from "./service";
import { logger } from "../../observability";

export const ORDER_STATUSES = ["placed", "accepted", "ready", "delivered", "cancelled"] as const;
type OrderStatus = typeof ORDER_STATUSES[number];

// What the business may change an order to, from each status.
const NEXT: Record<OrderStatus, OrderStatus[]> = {
  placed: ["accepted", "cancelled"],
  accepted: ["ready", "delivered", "cancelled"],
  ready: ["delivered", "cancelled"],
  delivered: [],
  cancelled: [],
};

const STATUS_TEXT: Record<OrderStatus, string> = {
  placed: "placed",
  accepted: "accepted. We are preparing it",
  ready: "ready",
  delivered: "delivered. Thank you",
  cancelled: "cancelled",
};

export async function ensureOrdersTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "business_orders" (
      "id" serial PRIMARY KEY,
      "business_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "customer_user_id" integer NOT NULL,
      "business_conversation_id" integer,
      "message_id" integer,
      "items" jsonb NOT NULL,
      "total_paise" integer NOT NULL DEFAULT 0,
      "note" text,
      "status" text NOT NULL DEFAULT 'placed',
      "cancel_reason" text,
      "created_at" timestamp DEFAULT now(),
      "updated_at" timestamp DEFAULT now()
    )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "business_orders_business_idx" ON "business_orders" ("business_id", "created_at")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "business_orders_customer_idx" ON "business_orders" ("customer_user_id", "business_id")`);
}

interface OrderItem { itemId: number; name: string; quantity: number; pricePaise: number | null }
interface OrderRow {
  id: number; business_id: number; customer_user_id: number; business_conversation_id: number | null; message_id: number | null;
  items: OrderItem[]; total_paise: number; note: string | null; status: OrderStatus; cancel_reason: string | null;
  created_at: Date; updated_at: Date;
}

function rows<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? (result as T[])) || [];
}

function rupees(paise: number): string {
  const r = paise / 100;
  return `₹${Number.isInteger(r) ? r.toLocaleString("en-IN") : r.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function present(o: OrderRow, customerName?: string | null) {
  return {
    id: o.id,
    businessId: o.business_id,
    messageId: o.message_id,
    conversationId: o.business_conversation_id,
    items: o.items,
    totalPaise: o.total_paise,
    note: o.note,
    status: o.status,
    cancelReason: o.cancel_reason,
    createdAt: o.created_at,
    updatedAt: o.updated_at,
    nextStatuses: NEXT[o.status],
    ...(customerName !== undefined ? { customerName } : {}),
  };
}

export async function isOrderMessage(messageId: number): Promise<boolean> {
  try {
    return rows(await db.execute(sql`SELECT 1 FROM business_orders WHERE message_id = ${messageId} LIMIT 1`)).length > 0;
  } catch {
    return false;
  }
}

function validIds(req: Request, res: Response, next: NextFunction) {
  for (const key of ["businessId", "orderId"]) {
    const value = req.params[key];
    if (value !== undefined && !(Number.isSafeInteger(Number(value)) && Number(value) > 0)) {
      return res.status(400).json({ success: false, error: "Invalid id." });
    }
  }
  next();
}

const orderSchema = z.object({
  items: z.array(z.object({ itemId: z.number().int().positive(), quantity: z.number().int().min(1).max(99) })).min(1).max(30),
  note: z.string().trim().max(500).optional(),
});

export function registerOrderRoutes(app: Express): void {
  const team = [requireAuth, validIds, requireCompanyAccess("businessId"), requirePermission(PERMISSIONS.MESSAGING_SEND)];

  // Customer places an order.
  app.post("/api/messaging/business/:businessId/orders", requireAuth, validIds, async (req: Request, res: Response) => {
    const businessId = Number(req.params.businessId);
    const parsed = orderSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ success: false, error: "Pick at least one item (1–99 each)." });
    try {
      const [org] = await db.select({ status: organizations.status, isActive: organizations.isActive }).from(organizations).where(eq(organizations.id, businessId));
      if (!org || org.status !== "approved" || !org.isActive) return res.status(404).json({ success: false, error: "Business not found" });

      // Same item twice -> one line.
      const wanted = new Map<number, number>();
      for (const i of parsed.data.items) wanted.set(i.itemId, Math.min(99, (wanted.get(i.itemId) ?? 0) + i.quantity));
      const catalog = await db.select().from(businessCatalogItems)
        .where(and(eq(businessCatalogItems.businessId, businessId), inArray(businessCatalogItems.id, Array.from(wanted.keys()))));
      const unavailable = Array.from(wanted.keys()).filter((id) => !catalog.some((c) => c.id === id && c.isAvailable));
      if (unavailable.length) return res.status(409).json({ success: false, error: "Some items are no longer available. Refresh the catalog." });

      const items: OrderItem[] = catalog.map((c) => ({ itemId: c.id, name: c.name, quantity: wanted.get(c.id)!, pricePaise: c.pricePaise ?? null }));
      const total = items.reduce((sum, i) => sum + (i.pricePaise ?? 0) * i.quantity, 0);
      const unpriced = items.some((i) => i.pricePaise == null);

      const lines = items.map((i) => `• ${i.quantity} × ${i.name}${i.pricePaise != null ? ` — ${rupees(i.pricePaise * i.quantity)}` : ""}`);
      const text = [
        "🛒 New order",
        ...lines,
        `Total: ${rupees(total)}${unpriced ? " + items priced by the shop" : ""}`,
        ...(parsed.data.note ? [`Note: ${parsed.data.note}`] : []),
      ].join("\n");

      const sent = await sendUserInitiatedMessage({ businessId, authenticatedUserId: req.user!.id, content: text });
      const [conv] = await db.select({ id: businessConversations.id }).from(businessConversations)
        .innerJoin(customers, eq(customers.id, businessConversations.customerId))
        .where(and(eq(businessConversations.businessId, businessId), eq(customers.linkedUserId, req.user!.id)))
        .limit(1);

      const created = rows<OrderRow>(await db.execute(sql`
        INSERT INTO business_orders (business_id, customer_user_id, business_conversation_id, message_id, items, total_paise, note)
        VALUES (${businessId}, ${req.user!.id}, ${conv?.id ?? null}, ${sent.message.id}, ${JSON.stringify(items)}::jsonb, ${total}, ${parsed.data.note ?? null})
        RETURNING *`))[0];
      return res.status(201).json({ success: true, order: present(created) });
    } catch (err) {
      if (err instanceof BusinessBlockedError) return res.status(409).json({ success: false, error: "You blocked this business. Unblock it to order." });
      logger.error("Orders", "Could not place order", err as Error);
      return res.status(500).json({ success: false, error: "Could not place the order. Try again." });
    }
  });

  // Customer: my orders with this business.
  app.get("/api/messaging/business/:businessId/orders", requireAuth, validIds, async (req: Request, res: Response) => {
    const list = rows<OrderRow>(await db.execute(sql`
      SELECT * FROM business_orders WHERE business_id = ${Number(req.params.businessId)} AND customer_user_id = ${req.user!.id}
      ORDER BY created_at DESC LIMIT 50`));
    return res.json({ success: true, orders: list.map((o) => present(o)) });
  });

  // Customer cancels while the shop hasn't accepted it yet.
  app.post("/api/messaging/business/:businessId/orders/:orderId/cancel", requireAuth, validIds, async (req: Request, res: Response) => {
    const businessId = Number(req.params.businessId);
    const updated = rows<OrderRow>(await db.execute(sql`
      UPDATE business_orders SET status = 'cancelled', cancel_reason = 'Cancelled by the customer', updated_at = now()
      WHERE id = ${Number(req.params.orderId)} AND business_id = ${businessId} AND customer_user_id = ${req.user!.id} AND status = 'placed'
      RETURNING *`))[0];
    if (!updated) return res.status(409).json({ success: false, error: "The shop already accepted this order. Message them to change it." });
    try {
      await sendUserInitiatedMessage({ businessId, authenticatedUserId: req.user!.id, content: `❌ I cancelled order #${updated.id}.` });
    } catch (err) { logger.warn("Orders", "Cancel message not sent", { error: (err as Error).message }); }
    return res.json({ success: true, order: present(updated) });
  });

  // Business: all orders, newest first; ?status=open|placed|... filters.
  app.get("/api/business/:businessId/orders", ...team, async (req: Request, res: Response) => {
    const businessId = Number(req.params.businessId);
    const status = String(req.query.status ?? "");
    const filter = status === "open"
      ? sql`AND o.status IN ('placed','accepted','ready')`
      : (ORDER_STATUSES as readonly string[]).includes(status) ? sql`AND o.status = ${status}` : sql``;
    const list = rows<OrderRow & { customer_name: string | null }>(await db.execute(sql`
      SELECT o.*, COALESCE(NULLIF(u.display_name, ''), u.username) AS customer_name
      FROM business_orders o LEFT JOIN users u ON u.id = o.customer_user_id
      WHERE o.business_id = ${businessId} ${filter}
      ORDER BY o.created_at DESC LIMIT 100`));
    const counts = rows<{ status: string; n: number }>(await db.execute(sql`
      SELECT status, COUNT(*)::int AS n FROM business_orders WHERE business_id = ${businessId} GROUP BY status`));
    return res.json({
      success: true,
      orders: list.map((o) => present(o, o.customer_name)),
      counts: Object.fromEntries(counts.map((c) => [c.status, Number(c.n)])),
    });
  });

  // Business moves an order along; the customer gets it as a chat message.
  app.patch("/api/business/:businessId/orders/:orderId", ...team, async (req: Request, res: Response) => {
    const businessId = Number(req.params.businessId);
    const parsed = z.object({ status: z.enum(ORDER_STATUSES), reason: z.string().trim().max(300).optional() }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ success: false, error: "Pick a status." });
    const { status, reason } = parsed.data;
    const allowedFrom = (Object.keys(NEXT) as OrderStatus[]).filter((from) => NEXT[from].includes(status));
    if (allowedFrom.length === 0) return res.status(400).json({ success: false, error: "That status can't be set." });
    const updated = rows<OrderRow>(await db.execute(sql`
      UPDATE business_orders SET status = ${status}, cancel_reason = ${status === "cancelled" ? (reason || "Cancelled by the shop") : null}, updated_at = now()
      WHERE id = ${Number(req.params.orderId)} AND business_id = ${businessId}
        AND status IN (${sql.join(allowedFrom.map((s) => sql`${s}`), sql`, `)})
      RETURNING *`))[0];
    if (!updated) {
      const current = rows<{ status: string }>(await db.execute(sql`
        SELECT status FROM business_orders WHERE id = ${Number(req.params.orderId)} AND business_id = ${businessId}`))[0];
      if (!current) return res.status(404).json({ success: false, error: "Order not found." });
      return res.status(409).json({ success: false, error: `This order is ${current.status} — it can't be marked ${status} now.` });
    }

    if (updated.business_conversation_id) {
      const text = `📦 Your order #${updated.id} is ${STATUS_TEXT[status]}${status === "cancelled" && reason ? ` — ${reason}` : ""}.`;
      try {
        await sendBusinessAgentMessage({ businessId, businessConversationId: updated.business_conversation_id, authenticatedUserId: req.user!.id, content: text });
      } catch (err) { logger.warn("Orders", "Status message not sent", { error: (err as Error).message }); }
    }
    return res.json({ success: true, order: present(updated) });
  });
}
