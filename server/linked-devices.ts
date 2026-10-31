/**
 * Linked devices (like WhatsApp Web): a browser asks to be linked, shows a
 * short code + QR; the person approves it from their signed-in phone. The
 * browser then picks up a new session using a secret only it knows, so
 * someone who merely sees the code can't take over the account.
 * Also: list and sign out signed-in devices.
 */
import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { userSessions, users } from "@shared/schema";
import { requireAuth, createSession } from "./role-middleware";
import { authLimiter } from "./rate-limit";

const router = Router();
const LINK_MINUTES = 3;
// No 0/O/1/I/L: easy to read aloud and type.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export async function ensureLinkedDevicesTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "device_link_requests" (
      "secret_hash" text PRIMARY KEY NOT NULL,
      "display_code" text NOT NULL,
      "user_agent" text,
      "ip_address" text,
      "approved_by_user_id" integer REFERENCES "users"("id") ON DELETE CASCADE,
      "created_at" timestamp DEFAULT now(),
      "expires_at" timestamp NOT NULL
    )`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "device_link_requests_code" ON "device_link_requests" ("display_code")`);
}

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

function displayCode(): string {
  let out = "";
  for (let i = 0; i < 8; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

const normalizeCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Browser: start linking. Returns the secret (kept by the browser) and the code to show. */
router.post("/api/link-device/start", authLimiter, async (req: Request, res: Response) => {
  await db.execute(sql`DELETE FROM device_link_requests WHERE expires_at < now() - interval '1 hour'`).catch(() => undefined);
  const secret = crypto.randomBytes(32).toString("base64url");
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = displayCode();
    try {
      await db.execute(sql`
        INSERT INTO device_link_requests (secret_hash, display_code, user_agent, ip_address, expires_at)
        VALUES (${sha(secret)}, ${code}, ${String(req.headers["user-agent"] ?? "").slice(0, 500)}, ${(req.ip ?? "").slice(0, 45)},
                now() + make_interval(mins => ${LINK_MINUTES}))`);
      const expiresAt = new Date(Date.now() + LINK_MINUTES * 60_000).toISOString();
      return res.json({ success: true, secret, code, expiresAt });
    } catch {
      // Code collided with a live one: try another.
    }
  }
  res.status(503).json({ success: false, message: "Please try again." });
});

type LinkRow = { secret_hash: string; display_code: string; user_agent: string | null; ip_address: string | null; approved_by_user_id: number | null; expired: boolean };

/** Browser: poll until approved. On approval the session is created here, once. */
router.get("/api/link-device/status", async (req: Request, res: Response) => {
  const secret = String(req.query.secret ?? "");
  if (secret.length < 20) return res.status(400).json({ success: false, message: "Invalid request." });
  const result = await db.execute(sql`SELECT secret_hash, display_code, user_agent, ip_address, approved_by_user_id, (expires_at < now()) AS expired
    FROM device_link_requests WHERE secret_hash = ${sha(secret)}`);
  const row = (result as unknown as { rows: LinkRow[] }).rows[0];
  if (!row) return res.json({ success: true, status: "expired" });
  if (!row.approved_by_user_id) return res.json({ success: true, status: row.expired ? "expired" : "pending" });
  // Approved: hand out the session exactly once.
  const claimed = await db.execute(sql`DELETE FROM device_link_requests WHERE secret_hash = ${row.secret_hash} RETURNING approved_by_user_id`);
  if (!(claimed as unknown as { rows: unknown[] }).rows.length) return res.json({ success: true, status: "expired" });
  const [user] = await db.select().from(users).where(eq(users.id, row.approved_by_user_id));
  if (!user?.isActive) return res.status(403).json({ success: false, message: "This account is inactive." });
  const { storage } = await import("./storage");
  const { buildSessionBinding } = await import("./modules/auth/service");
  const organization = user.organizationId ? await storage.getOrganization(user.organizationId) : null;
  const token = await createSession(user.id, `[Linked] ${row.user_agent ?? ""}`.slice(0, 500), row.ip_address ?? undefined, buildSessionBinding(organization));
  const { password: _pw, ...safeUser } = user;
  res.json({ success: true, status: "linked", token, user: safeUser });
});

/** Phone: approve a code shown on a computer. */
// Wrong codes per person (not per network): 10 per 10 minutes.
const wrongCodes = new Map<number, { count: number; since: number }>();
function tooManyWrongCodes(userId: number): boolean {
  const w = wrongCodes.get(userId);
  if (!w || Date.now() - w.since > 10 * 60_000) return false;
  return w.count >= 10;
}
function noteWrongCode(userId: number) {
  const w = wrongCodes.get(userId);
  if (!w || Date.now() - w.since > 10 * 60_000) wrongCodes.set(userId, { count: 1, since: Date.now() });
  else w.count++;
}

router.post("/api/link-device/approve", requireAuth, async (req: Request, res: Response) => {
  if (tooManyWrongCodes(req.user!.id)) return res.status(429).json({ success: false, message: "Too many wrong codes. Try again in 10 minutes." });
  // A scanned QR is a full link (https://neuratalk.in/link-device?code=...), longer than the code itself.
  const parsed = z.object({ code: z.string().min(6).max(300) }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ success: false, message: "Enter the code shown on your computer." });
  // The QR holds a link: take the code out of it.
  let raw = parsed.data.code.trim();
  try {
    const url = new URL(raw);
    raw = url.searchParams.get("code") ?? raw;
  } catch { /* plain code */ }
  const code = normalizeCode(raw);
  const result = await db.execute(sql`
    UPDATE device_link_requests SET approved_by_user_id = ${req.user!.id}
    WHERE display_code = ${code} AND approved_by_user_id IS NULL AND expires_at > now()
    RETURNING user_agent`);
  const row = (result as unknown as { rows: Array<{ user_agent: string | null }> }).rows[0];
  if (!row) {
    noteWrongCode(req.user!.id);
    return res.status(404).json({ success: false, message: "That code is wrong or has expired. Refresh the page on your computer for a new one." });
  }
  res.json({ success: true, device: describeDevice(row.user_agent) });
});

function describeDevice(ua: string | null | undefined): string {
  const s = String(ua ?? "").replace(/^\[Linked\]\s*/, "");
  const browser = /Edg\//.test(s) ? "Edge" : /Chrome\//.test(s) ? "Chrome" : /Firefox\//.test(s) ? "Firefox" : /Safari\//.test(s) ? "Safari" : /Dart|okhttp/i.test(s) || !s.trim() ? "NeuraTalk app" : "Browser";
  const os = /Windows/.test(s) ? "Windows" : /Mac OS X/.test(s) && !/iPhone|iPad/.test(s) ? "Mac" : /Android/.test(s) ? "Android" : /iPhone|iPad/.test(s) ? "iPhone" : /Linux/.test(s) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

// ---------------------------------------------------------------- signed-in devices
function currentToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return null;
}

router.get("/api/linked-devices", requireAuth, async (req: Request, res: Response) => {
  const rows = await db.select({
    id: userSessions.id, token: userSessions.token, userAgent: userSessions.userAgent, ipAddress: userSessions.ipAddress,
    createdAt: userSessions.createdAt, lastActivityAt: userSessions.lastActivityAt,
  }).from(userSessions)
    .where(and(eq(userSessions.userId, req.user!.id), gt(userSessions.expiresAt, new Date())))
    .orderBy(desc(userSessions.lastActivityAt));
  const mine = currentToken(req);
  res.json({
    success: true,
    sessions: rows.map((r) => ({
      id: r.id,
      device: describeDevice(r.userAgent),
      linked: String(r.userAgent ?? "").startsWith("[Linked]"),
      ip: r.ipAddress ? r.ipAddress.replace(/\.\d+$/, ".x") : null,
      createdAt: r.createdAt,
      lastActivityAt: r.lastActivityAt,
      current: mine !== null && r.token === mine,
    })),
  });
});

router.delete("/api/linked-devices/:id", requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ success: false, message: "Invalid device." });
  const deleted = await db.delete(userSessions).where(and(eq(userSessions.id, id), eq(userSessions.userId, req.user!.id))).returning({ id: userSessions.id });
  if (!deleted.length) return res.status(404).json({ success: false, message: "Device not found." });
  res.json({ success: true });
});

/** Sign out every device except this one. */
router.post("/api/linked-devices/sign-out-others", requireAuth, async (req: Request, res: Response) => {
  const mine = currentToken(req);
  if (!mine) return res.status(400).json({ success: false, message: "Use the app to do this." });
  const deleted = await db.delete(userSessions)
    .where(and(eq(userSessions.userId, req.user!.id), sql`${userSessions.token} <> ${mine}`))
    .returning({ id: userSessions.id });
  res.json({ success: true, signedOut: deleted.length });
});

export default router;
