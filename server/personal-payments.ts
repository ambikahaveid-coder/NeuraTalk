/**
 * Payments between friends in a 1:1 chat, by UPI.
 *
 * Each person saves their own UPI ID once. In a chat they can:
 *  - Request money: a card appears; the other person pays from their own
 *    UPI app (upi://pay link), taps "I've paid", and the requester confirms.
 *  - Pay: opens their UPI app to the other person's UPI ID.
 * The money goes bank to bank through UPI. NeuraTalk never holds or moves
 * it, and shows someone's UPI ID only to people they have a chat with.
 */
import { Router, type Request, type Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { personalChatMessages, personalChatThreads } from "@shared/schema";
import { requireAuth } from "./role-middleware";
import { isBlocked } from "./blocking";
import { sendPersonalMessage } from "./personal-chat-routes";
import { rupees, upiLink } from "./modules/messaging/chat-payments";

const router = Router();
export const MAX_P2P_PAISE = 1_00_000_00; // ₹1,00,000

export async function ensurePersonalPaymentTables(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "user_payment_settings" (
      "user_id" integer PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
      "upi_id" text NOT NULL,
      "payee_name" text NOT NULL,
      "updated_at" timestamp NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "personal_payment_requests" (
      "id" serial PRIMARY KEY,
      "thread_id" integer NOT NULL REFERENCES "personal_chat_threads"("id") ON DELETE CASCADE,
      "requester_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "payer_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "message_id" integer,
      "amount_paise" integer NOT NULL,
      "note" text,
      "upi_id" text NOT NULL,
      "payee_name" text NOT NULL,
      "status" text NOT NULL DEFAULT 'requested',
      "payer_reference" text,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "payer_paid_at" timestamp,
      "settled_at" timestamp
    )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "personal_payment_requests_users" ON "personal_payment_requests" ("requester_id", "payer_id")`);
}

type Row = {
  id: number; thread_id: number; requester_id: number; payer_id: number; message_id: number | null; amount_paise: number;
  note: string | null; upi_id: string; payee_name: string; status: "requested" | "payer_paid" | "paid" | "declined" | "cancelled";
  payer_reference: string | null; created_at: Date;
};
const rows = <T>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? []) as T[];
const idOf = (v: unknown) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const reference = (id: number) => `NTP${id}`;

const upiSchema = z.object({
  upiId: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{2,256}@[a-z][a-z0-9.-]{1,63}$/, "Enter a UPI ID like name@okaxis"),
  payeeName: z.string().trim().min(2).max(60),
});

async function upiOf(userId: number): Promise<{ upiId: string; payeeName: string } | null> {
  const r = rows<{ upi_id: string; payee_name: string }>(await db.execute(sql`SELECT upi_id, payee_name FROM user_payment_settings WHERE user_id = ${userId}`))[0];
  return r ? { upiId: r.upi_id, payeeName: r.payee_name } : null;
}

async function threadFor(threadId: number, userId: number) {
  const [t] = await db.select().from(personalChatThreads).where(eq(personalChatThreads.id, threadId));
  if (!t || (t.participantAUserId !== userId && t.participantBUserId !== userId)) return null;
  return { thread: t, peerId: t.participantAUserId === userId ? t.participantBUserId : t.participantAUserId };
}

/** What the chat card shows; kept on the message and refreshed at each step. */
function cardMeta(p: Row) {
  return {
    payment: {
      kind: "p2p", requestId: p.id, amountPaise: p.amount_paise, note: p.note, upiId: p.upi_id, payeeName: p.payee_name,
      requesterId: p.requester_id, payerId: p.payer_id, status: p.status, reference: reference(p.id),
      upiLink: upiLink({ upiId: p.upi_id, payeeName: p.payee_name, amountPaise: p.amount_paise, note: p.note, reference: reference(p.id) }),
    },
  };
}

async function refreshCard(p: Row) {
  if (!p.message_id) return;
  await db.update(personalChatMessages)
    .set({ metadata: sql`coalesce(${personalChatMessages.metadata}, '{}'::jsonb) || ${JSON.stringify(cardMeta(p))}::jsonb` })
    .where(eq(personalChatMessages.id, p.message_id));
}

const present = (p: Row, me: number) => ({
  id: p.id, threadId: p.thread_id, amountPaise: p.amount_paise, note: p.note, status: p.status, reference: reference(p.id),
  payerReference: p.payer_reference, direction: p.requester_id === me ? "to_receive" : "to_pay", createdAt: p.created_at,
});

// ---------------------------------------------------------------- my UPI ID
router.get("/api/me/upi", requireAuth, async (req: Request, res: Response) => {
  res.json({ success: true, upi: await upiOf(req.user!.id) });
});

router.put("/api/me/upi", requireAuth, async (req: Request, res: Response) => {
  const parsed = upiSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Check the UPI ID." });
  await db.execute(sql`
    INSERT INTO user_payment_settings (user_id, upi_id, payee_name) VALUES (${req.user!.id}, ${parsed.data.upiId}, ${parsed.data.payeeName})
    ON CONFLICT (user_id) DO UPDATE SET upi_id = EXCLUDED.upi_id, payee_name = EXCLUDED.payee_name, updated_at = now()`);
  res.json({ success: true, upi: parsed.data });
});

router.delete("/api/me/upi", requireAuth, async (req: Request, res: Response) => {
  await db.execute(sql`DELETE FROM user_payment_settings WHERE user_id = ${req.user!.id}`);
  res.json({ success: true });
});

/** "Pay": the other person's UPI ID, only inside a chat you're both in. */
router.get("/api/personal-chats/:threadId/peer-upi", requireAuth, async (req: Request, res: Response) => {
  const threadId = idOf(req.params.threadId);
  const t = threadId ? await threadFor(threadId, req.user!.id) : null;
  if (!t) return res.status(404).json({ error: "Chat not found." });
  if (await isBlocked(req.user!.id, t.peerId)) return res.status(403).json({ error: "You can't pay this person." });
  res.json({ success: true, upi: await upiOf(t.peerId) });
});

// ---------------------------------------------------------------- requests
router.post("/api/personal-chats/:threadId/payment-request", requireAuth, async (req: Request, res: Response) => {
  const me = req.user!.id;
  const threadId = idOf(req.params.threadId);
  const t = threadId ? await threadFor(threadId, me) : null;
  if (!t) return res.status(404).json({ error: "Chat not found." });
  const parsed = z.object({
    amountPaise: z.number().int().min(100, "The smallest request is ₹1").max(MAX_P2P_PAISE, "The most you can request at once is ₹1,00,000"),
    note: z.string().trim().max(80).optional(),
  }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Enter the amount." });
  const upi = await upiOf(me);
  if (!upi) return res.status(400).json({ code: "NO_UPI_ID", error: "Add your UPI ID first." });
  if (await isBlocked(me, t.peerId)) return res.status(403).json({ error: "You can't message this person." });
  // At most 20 open requests to one person, so nobody is spammed with requests.
  const [{ n }] = rows<{ n: number }>(await db.execute(sql`SELECT count(*)::int AS n FROM personal_payment_requests WHERE requester_id = ${me} AND payer_id = ${t.peerId} AND status = 'requested'`));
  if (n >= 20) return res.status(429).json({ error: "You already have 20 open requests with this person." });

  const created = rows<Row>(await db.execute(sql`
    INSERT INTO personal_payment_requests (thread_id, requester_id, payer_id, amount_paise, note, upi_id, payee_name)
    VALUES (${t.thread.id}, ${me}, ${t.peerId}, ${parsed.data.amountPaise}, ${parsed.data.note ?? null}, ${upi.upiId}, ${upi.payeeName})
    RETURNING *`))[0];
  const text = `💳 Requested ${rupees(created.amount_paise)}${created.note ? ` for ${created.note}` : ""}`;
  const out = await sendPersonalMessage(req.user as any, t.thread.id, { content: text, clientMessageId: `pay-${created.id}` }, cardMeta(created));
  if (out.status >= 300) {
    await db.execute(sql`DELETE FROM personal_payment_requests WHERE id = ${created.id}`);
    return res.status(out.status).json(out.body);
  }
  const messageId = out.body?.message?.id as number;
  await db.execute(sql`UPDATE personal_payment_requests SET message_id = ${messageId} WHERE id = ${created.id}`);
  res.status(201).json({ success: true, request: present({ ...created, message_id: messageId }, me), message: out.body.message });
});

/** The payer: "I've paid" (optional UTR), or "Decline". */
router.post("/api/personal-payments/:id/paid", requireAuth, async (req: Request, res: Response) => {
  const me = req.user!.id;
  const id = idOf(req.params.id);
  const parsed = z.object({ reference: z.string().trim().regex(/^[A-Za-z0-9]{6,30}$/, "The UTR is 12 digits, shown in your UPI app after paying").optional() }).safeParse(req.body ?? {});
  if (!id || !parsed.success) return res.status(400).json({ error: parsed.success ? "Invalid request." : parsed.error.issues[0]?.message });
  const updated = rows<Row>(await db.execute(sql`
    UPDATE personal_payment_requests SET status = 'payer_paid', payer_paid_at = now(), payer_reference = ${parsed.data.reference ?? null}
    WHERE id = ${id} AND payer_id = ${me} AND status = 'requested' RETURNING *`))[0];
  if (!updated) return refuse(res, id, me);
  await refreshCard(updated);
  await sendPersonalMessage(req.user as any, updated.thread_id, {
    content: `💸 I've paid ${rupees(updated.amount_paise)} by UPI${updated.payer_reference ? ` (UTR ${updated.payer_reference})` : ""}.`,
  });
  res.json({ success: true, request: present(updated, me) });
});

router.post("/api/personal-payments/:id/decline", requireAuth, async (req: Request, res: Response) => {
  const me = req.user!.id;
  const id = idOf(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid request." });
  const updated = rows<Row>(await db.execute(sql`
    UPDATE personal_payment_requests SET status = 'declined', settled_at = now()
    WHERE id = ${id} AND payer_id = ${me} AND status = 'requested' RETURNING *`))[0];
  if (!updated) return refuse(res, id, me);
  await refreshCard(updated);
  await sendPersonalMessage(req.user as any, updated.thread_id, { content: `Declined the request for ${rupees(updated.amount_paise)}.` });
  res.json({ success: true, request: present(updated, me) });
});

/** The requester: the money arrived (paid), or withdraw the request (cancelled). */
router.patch("/api/personal-payments/:id", requireAuth, async (req: Request, res: Response) => {
  const me = req.user!.id;
  const id = idOf(req.params.id);
  const parsed = z.object({ status: z.enum(["paid", "cancelled"]) }).safeParse(req.body ?? {});
  if (!id || !parsed.success) return res.status(400).json({ error: "Pick paid or cancelled." });
  const updated = rows<Row>(await db.execute(sql`
    UPDATE personal_payment_requests SET status = ${parsed.data.status}, settled_at = now()
    WHERE id = ${id} AND requester_id = ${me} AND status IN ('requested', 'payer_paid') RETURNING *`))[0];
  if (!updated) return refuse(res, id, me);
  await refreshCard(updated);
  await sendPersonalMessage(req.user as any, updated.thread_id, {
    content: parsed.data.status === "paid" ? `✅ Received ${rupees(updated.amount_paise)}. Thank you!` : `Cancelled my request for ${rupees(updated.amount_paise)}.`,
  });
  res.json({ success: true, request: present(updated, me) });
});

router.get("/api/personal-payments", requireAuth, async (req: Request, res: Response) => {
  const me = req.user!.id;
  const list = rows<Row & { other_name: string | null }>(await db.execute(sql`
    SELECT p.*, coalesce(nullif(trim(u.display_name), ''), u.username, u.phone) AS other_name
    FROM personal_payment_requests p
    JOIN users u ON u.id = CASE WHEN p.requester_id = ${me} THEN p.payer_id ELSE p.requester_id END
    WHERE p.requester_id = ${me} OR p.payer_id = ${me}
    ORDER BY p.created_at DESC LIMIT 100`));
  res.json({ success: true, requests: list.map((p) => ({ ...present(p, me), otherName: p.other_name })) });
});

async function refuse(res: Response, id: number, me: number) {
  const cur = rows<{ status: string; requester_id: number; payer_id: number }>(await db.execute(sql`SELECT status, requester_id, payer_id FROM personal_payment_requests WHERE id = ${id}`))[0];
  if (!cur || (cur.requester_id !== me && cur.payer_id !== me)) return res.status(404).json({ error: "Payment request not found." });
  if (cur.status === "requested" || cur.status === "payer_paid") {
    return res.status(403).json({ error: cur.requester_id === me ? "Only the person you asked can pay or decline." : "Only the person who asked can confirm or cancel." });
  }
  return res.status(409).json({ error: cur.status === "payer_paid" ? "Already marked as paid." : `This request is ${cur.status === "paid" ? "already paid" : cur.status}.` });
}

export default router;
