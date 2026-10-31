/**
 * Two-step verification (WhatsApp style): an optional 6-digit PIN asked
 * after the phone OTP whenever someone signs in. The PIN is stored only as
 * a salted scrypt hash. Forgot PIN: a reset can be requested at sign-in and
 * takes effect after 7 days (so a SIM thief can't just reset it).
 */
import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { promisify } from "util";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { users } from "@shared/schema";
import { requireAuth, createSession } from "./role-middleware";
import { logger } from "./observability";

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const router = Router();

export const TWO_STEP_RESET_DAYS = 7;
const TICKET_MINUTES = 10;
const MAX_TRIES_PER_TICKET = 5;

export async function ensureTwoStepTables(): Promise<void> {
  await db.execute(sql`ALTER TABLE "user_privacy_settings" ADD COLUMN IF NOT EXISTS "two_step_pin_hash" text`);
  await db.execute(sql`ALTER TABLE "user_privacy_settings" ADD COLUMN IF NOT EXISTS "two_step_reset_requested_at" timestamp`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "two_step_tickets" (
      "ticket" text PRIMARY KEY NOT NULL,
      "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "attempts" integer NOT NULL DEFAULT 0,
      "user_agent" text,
      "ip_address" text,
      "expires_at" timestamp NOT NULL
    )`);
}

async function hashPin(pin: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pin, salt, 32);
  return `s1:${salt.toString("hex")}:${key.toString("hex")}`;
}

async function pinMatches(pin: string, stored: string): Promise<boolean> {
  const [v, saltHex, keyHex] = stored.split(":");
  if (v !== "s1" || !saltHex || !keyHex) return false;
  const key = await scrypt(pin, Buffer.from(saltHex, "hex"), 32);
  const expected = Buffer.from(keyHex, "hex");
  return expected.length === key.length && crypto.timingSafeEqual(expected, key);
}

type TwoStepRow = { pinHash: string | null; resetRequestedAt: Date | null };

async function twoStepRow(userId: number): Promise<TwoStepRow> {
  try {
    const result = await db.execute(sql`SELECT two_step_pin_hash, two_step_reset_requested_at FROM user_privacy_settings WHERE user_id = ${userId}`);
    const row = (result as unknown as { rows: Array<{ two_step_pin_hash: string | null; two_step_reset_requested_at: Date | null }> }).rows[0];
    return { pinHash: row?.two_step_pin_hash ?? null, resetRequestedAt: row?.two_step_reset_requested_at ? new Date(row.two_step_reset_requested_at) : null };
  } catch {
    return { pinHash: null, resetRequestedAt: null };
  }
}

async function setPinHash(userId: number, pinHash: string | null) {
  await db.execute(sql`
    INSERT INTO user_privacy_settings (user_id, two_step_pin_hash, two_step_reset_requested_at, updated_at)
    VALUES (${userId}, ${pinHash}, NULL, now())
    ON CONFLICT (user_id) DO UPDATE SET two_step_pin_hash = ${pinHash}, two_step_reset_requested_at = NULL, updated_at = now()`);
}

/**
 * Called by every phone/OTP sign-in just before a session is made. Returns
 * null to let the sign-in finish, or a ticket the app must complete with the PIN.
 */
export async function twoStepGate(userId: number, context?: { userAgent?: string; ipAddress?: string }): Promise<null | { ticket: string; resetAvailableAt: string | null }> {
  const row = await twoStepRow(userId);
  if (!row.pinHash) return null;
  // A reset asked for 7+ days ago: the PIN is removed and the sign-in goes through.
  if (row.resetRequestedAt && Date.now() - row.resetRequestedAt.getTime() >= TWO_STEP_RESET_DAYS * 86400_000) {
    await setPinHash(userId, null);
    logger.info("TwoStep", `PIN removed after the ${TWO_STEP_RESET_DAYS}-day reset for user ${userId}`);
    return null;
  }
  const ticket = crypto.randomBytes(32).toString("base64url");
  await db.execute(sql`DELETE FROM two_step_tickets WHERE expires_at < now()`).catch(() => undefined);
  await db.execute(sql`
    INSERT INTO two_step_tickets (ticket, user_id, user_agent, ip_address, expires_at)
    VALUES (${ticket}, ${userId}, ${context?.userAgent?.slice(0, 500) ?? null}, ${context?.ipAddress?.slice(0, 45) ?? null}, now() + make_interval(mins => ${TICKET_MINUTES}))`);
  return {
    ticket,
    resetAvailableAt: row.resetRequestedAt ? new Date(row.resetRequestedAt.getTime() + TWO_STEP_RESET_DAYS * 86400_000).toISOString() : null,
  };
}

async function loadTicket(ticket: string) {
  const result = await db.execute(sql`SELECT ticket, user_id, attempts, user_agent, ip_address FROM two_step_tickets WHERE ticket = ${ticket} AND expires_at > now()`);
  return (result as unknown as { rows: Array<{ ticket: string; user_id: number; attempts: number; user_agent: string | null; ip_address: string | null }> }).rows[0] ?? null;
}

const pinSchema = z.string().regex(/^\d{6}$/, "The PIN is 6 digits.");

// ---------------------------------------------------------------- sign-in
router.post("/api/auth/two-step/verify", async (req: Request, res: Response) => {
  const parsed = z.object({ ticket: z.string().min(20).max(200), pin: pinSchema }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? "Enter your 6-digit PIN." });
  const t = await loadTicket(parsed.data.ticket);
  if (!t) return res.status(401).json({ success: false, code: "TICKET_EXPIRED", message: "This sign-in expired. Please start again." });
  if (t.attempts >= MAX_TRIES_PER_TICKET) {
    await db.execute(sql`DELETE FROM two_step_tickets WHERE ticket = ${t.ticket}`);
    return res.status(429).json({ success: false, code: "TOO_MANY_TRIES", message: "Too many wrong PINs. Please sign in again." });
  }
  const row = await twoStepRow(t.user_id);
  if (!row.pinHash || !(await pinMatches(parsed.data.pin, row.pinHash))) {
    await db.execute(sql`UPDATE two_step_tickets SET attempts = attempts + 1 WHERE ticket = ${t.ticket}`);
    const left = MAX_TRIES_PER_TICKET - t.attempts - 1;
    return res.status(401).json({ success: false, code: "WRONG_PIN", triesLeft: Math.max(0, left), message: left > 0 ? `Wrong PIN. ${left} ${left === 1 ? "try" : "tries"} left.` : "Wrong PIN. Please sign in again." });
  }
  await db.execute(sql`DELETE FROM two_step_tickets WHERE ticket = ${t.ticket}`);
  const [user] = await db.select().from(users).where(eq(users.id, t.user_id));
  if (!user?.isActive) return res.status(403).json({ success: false, message: "This account is inactive. Please contact your administrator." });
  // Signing in with the right PIN cancels a pending "forgot PIN" reset.
  await db.execute(sql`UPDATE user_privacy_settings SET two_step_reset_requested_at = NULL WHERE user_id = ${user.id}`);
  const { storage } = await import("./storage");
  const organization = user.organizationId ? await storage.getOrganization(user.organizationId) : null;
  const { buildSessionBinding } = await import("./modules/auth/service");
  const token = await createSession(user.id, t.user_agent ?? undefined, t.ip_address ?? undefined, buildSessionBinding(organization));
  const { password: _pw, ...safeUser } = user;
  res.json({ success: true, token, user: safeUser, isNewUser: false });
});

router.post("/api/auth/two-step/forgot", async (req: Request, res: Response) => {
  const parsed = z.object({ ticket: z.string().min(20).max(200) }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ success: false, message: "Invalid request." });
  const t = await loadTicket(parsed.data.ticket);
  if (!t) return res.status(401).json({ success: false, code: "TICKET_EXPIRED", message: "This sign-in expired. Please start again." });
  await db.execute(sql`UPDATE user_privacy_settings SET two_step_reset_requested_at = coalesce(two_step_reset_requested_at, now()) WHERE user_id = ${t.user_id}`);
  const row = await twoStepRow(t.user_id);
  const at = new Date((row.resetRequestedAt ?? new Date()).getTime() + TWO_STEP_RESET_DAYS * 86400_000);
  res.json({ success: true, resetAvailableAt: at.toISOString(), message: `You can sign in without the PIN after ${at.toDateString()}. If you remember it before then, the reset is cancelled.` });
});

// ---------------------------------------------------------------- settings
router.get("/api/privacy/two-step", requireAuth, async (req: Request, res: Response) => {
  const row = await twoStepRow(req.user!.id);
  res.json({ success: true, enabled: Boolean(row.pinHash) });
});

router.post("/api/privacy/two-step", requireAuth, async (req: Request, res: Response) => {
  const parsed = z.object({ pin: pinSchema, currentPin: z.string().optional() }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? "The PIN is 6 digits." });
  if (/^(\d)\1{5}$/.test(parsed.data.pin) || ["123456", "654321", "012345"].includes(parsed.data.pin)) {
    return res.status(400).json({ success: false, message: "Pick a PIN that's harder to guess." });
  }
  const row = await twoStepRow(req.user!.id);
  if (row.pinHash && !(parsed.data.currentPin && await pinMatches(parsed.data.currentPin, row.pinHash))) {
    return res.status(401).json({ success: false, code: "WRONG_PIN", message: "Your current PIN is wrong." });
  }
  await setPinHash(req.user!.id, await hashPin(parsed.data.pin));
  res.json({ success: true, enabled: true });
});

router.delete("/api/privacy/two-step", requireAuth, async (req: Request, res: Response) => {
  const parsed = z.object({ pin: pinSchema }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ success: false, message: "Enter your current PIN." });
  const row = await twoStepRow(req.user!.id);
  if (!row.pinHash) return res.json({ success: true, enabled: false });
  if (!(await pinMatches(parsed.data.pin, row.pinHash))) return res.status(401).json({ success: false, code: "WRONG_PIN", message: "That PIN is wrong." });
  await setPinHash(req.user!.id, null);
  res.json({ success: true, enabled: false });
});

export default router;
