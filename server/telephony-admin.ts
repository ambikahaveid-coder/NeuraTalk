/**
 * Phone lines for businesses (Exotel-style), through LiveKit SIP.
 *
 * Super admin connects the provider's SIP trunk once (outbound), and the inbound trunk +
 * dispatch rule are kept in step with the business numbers in org_did_numbers. Calls then
 * use the normal translated-call flow (server/pstn/livekit-sip.ts, server/pstn/inbound.ts).
 *
 * The provider's SIP password is passed straight to LiveKit and never stored by NeuraTalk.
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import { ListUpdate, SIPTransport } from "@livekit/protocol";
import { db } from "./db";
import { orgDIDNumbers, organizations } from "@shared/schema";
import { requireAuth, requireSuperAdmin } from "./role-middleware";
import { logger } from "./observability";
import { createAuditLog } from "./audit";
import { INBOUND_ROOM_PREFIX, getLiveKitOutboundTrunkId, setLiveKitOutboundTrunkId, sipClient } from "./pstn/livekit-sip";
import { listRecentCDRsForOrg } from "./pstn/cdr";

const INBOUND_TRUNK_NAME = "NeuraTalk";
const DISPATCH_RULE_NAME = "NeuraTalk business numbers";

export async function ensureTelephonyTables(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "telephony_trunks" (
      "id" serial PRIMARY KEY,
      "direction" text NOT NULL,
      "provider" text NOT NULL,
      "livekit_trunk_id" text NOT NULL UNIQUE,
      "name" text,
      "address" text,
      "numbers" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "created_by" integer,
      "created_at" timestamp DEFAULT now()
    )`);
  const rows = await db.execute(sql`SELECT "livekit_trunk_id" FROM "telephony_trunks" WHERE "direction" = 'outbound' ORDER BY "id" DESC LIMIT 1`);
  const id = (rows as any).rows?.[0]?.livekit_trunk_id ?? null;
  if (id) setLiveKitOutboundTrunkId(id);
}

const mask = (n: string) => n.replace(/\d(?=\d{4})/g, "•");
const E164 = z.string().regex(/^\+[1-9]\d{7,14}$/, "Use international format, e.g. +918012345678");

/**
 * Make the LiveKit inbound trunk carry our active inbound business numbers, and route them.
 * Only numbers this sync added earlier are ever removed: a number someone put on the trunk by
 * hand stays (we remember what we manage in telephony_trunks.numbers).
 */
export function mergeInboundNumbers(onTrunk: string[], managedBefore: string[], wanted: string[]): string[] {
  const dropped = new Set(managedBefore.filter((n) => !wanted.includes(n)));
  return Array.from(new Set([...onTrunk.filter((n) => !dropped.has(n)), ...wanted])).sort();
}

export async function syncInboundNumbers(opts: { allowedAddresses?: string[]; authUsername?: string; authPassword?: string } = {}) {
  const sip = sipClient();
  const dids = await db.select({ phoneNumber: orgDIDNumbers.phoneNumber }).from(orgDIDNumbers)
    .where(and(eq(orgDIDNumbers.isActive, true), inArray(orgDIDNumbers.type, ["inbound", "both"])));
  const wanted = Array.from(new Set(dids.map((d) => d.phoneNumber))).sort();

  const trunks = await sip.listSipInboundTrunk();
  let trunk = trunks.find((t) => t.name === INBOUND_TRUNK_NAME) ?? null;
  const managedRow = trunk
    ? await db.execute(sql`SELECT "numbers" FROM "telephony_trunks" WHERE "livekit_trunk_id" = ${trunk.sipTrunkId} LIMIT 1`)
    : null;
  const managedBefore: string[] = ((managedRow as any)?.rows?.[0]?.numbers as string[] | undefined) ?? [];
  const numbers = mergeInboundNumbers(trunk?.numbers ?? [], managedBefore, wanted);

  if (!trunk && numbers.length) {
    trunk = await sip.createSipInboundTrunk(INBOUND_TRUNK_NAME, numbers, {
      ...(opts.allowedAddresses?.length ? { allowedAddresses: opts.allowedAddresses } : {}),
      ...(opts.authUsername ? { authUsername: opts.authUsername, authPassword: opts.authPassword } : {}),
      krispEnabled: true,
    });
  } else if (trunk) {
    trunk = await sip.updateSipInboundTrunkFields(trunk.sipTrunkId, {
      numbers: new ListUpdate({ set: numbers }),
      ...(opts.allowedAddresses ? { allowedAddresses: new ListUpdate({ set: opts.allowedAddresses }) } : {}),
      ...(opts.authUsername ? { authUsername: opts.authUsername, authPassword: opts.authPassword ?? "" } : {}),
    });
  }

  if (trunk) {
    await db.execute(sql`INSERT INTO "telephony_trunks" ("direction","provider","livekit_trunk_id","name","numbers")
      VALUES ('inbound', 'livekit', ${trunk.sipTrunkId}, ${INBOUND_TRUNK_NAME}, ${JSON.stringify(wanted)}::jsonb)
      ON CONFLICT ("livekit_trunk_id") DO UPDATE SET "numbers" = EXCLUDED."numbers"`);
  }

  let dispatchRuleId: string | null = null;
  if (trunk) {
    const rules = await sip.listSipDispatchRule();
    const existing = rules.find((r) => r.name === DISPATCH_RULE_NAME);
    dispatchRuleId = existing?.sipDispatchRuleId
      ?? (await sip.createSipDispatchRule({ type: "individual", roomPrefix: INBOUND_ROOM_PREFIX }, { name: DISPATCH_RULE_NAME, trunkIds: [trunk.sipTrunkId] })).sipDispatchRuleId;
  }
  return { trunkId: trunk?.sipTrunkId ?? null, numbers, dispatchRuleId };
}

export async function telephonyStatus() {
  const outboundId = getLiveKitOutboundTrunkId();
  const provider = (process.env.PSTN_PROVIDER || "msg91").toLowerCase();
  const usesLiveKit = provider === "livekit_sip" || provider === "exotel";
  let sipReachable = false; let outboundExists = false; let error: string | null = null;
  let inbound: Array<{ id: string; name: string; numbers: string[]; secured: boolean }> = [];
  let ruleCount = 0;
  try {
    const sip = sipClient();
    const [out, inn, rules] = await Promise.all([sip.listSipOutboundTrunk(), sip.listSipInboundTrunk(), sip.listSipDispatchRule()]);
    sipReachable = true;
    outboundExists = Boolean(outboundId && out.some((t) => t.sipTrunkId === outboundId));
    inbound = inn.map((t) => ({ id: t.sipTrunkId, name: t.name, numbers: (t.numbers ?? []).map(mask), secured: Boolean((t.allowedAddresses ?? []).length || t.authUsername) }));
    ruleCount = rules.filter((r) => r.name === DISPATCH_RULE_NAME).length;
  } catch (e) {
    error = String((e as Error).message ?? e).slice(0, 160);
  }
  const numbers = await db.select({
    id: orgDIDNumbers.id, phoneNumber: orgDIDNumbers.phoneNumber, label: orgDIDNumbers.label, type: orgDIDNumbers.type,
    isActive: orgDIDNumbers.isActive, organizationId: orgDIDNumbers.organizationId, organizationName: organizations.name,
  }).from(orgDIDNumbers).leftJoin(organizations, eq(organizations.id, orgDIDNumbers.organizationId));
  const ourInbound = inbound.find((t) => t.name === INBOUND_TRUNK_NAME);
  const checklist = [
    { key: "livekit", label: "Phone lines enabled in LiveKit", ok: sipReachable },
    { key: "outbound", label: "Provider line connected for outgoing calls (Exotel)", ok: outboundExists },
    { key: "provider", label: "Server set to dial through LiveKit (PSTN_PROVIDER=exotel)", ok: usesLiveKit },
    { key: "numbers", label: "At least one business number assigned", ok: numbers.some((n) => n.isActive) },
    { key: "inbound", label: "Incoming line carries the business numbers", ok: Boolean(ourInbound) },
    { key: "secured", label: "Incoming line accepts calls only from the provider", ok: Boolean(ourInbound?.secured) },
    { key: "routing", label: "Incoming calls routed to businesses", ok: ruleCount > 0 },
  ];
  return {
    provider, usesLiveKit, sipReachable, error, outboundTrunkId: outboundExists ? outboundId : null, inbound, ruleCount,
    numbers: numbers.map((n) => ({ ...n, phoneNumber: n.phoneNumber })),
    checklist, ready: checklist.every((c) => c.ok),
  };
}

export function registerTelephonyAdminRoutes(app: Express): void {
  app.get("/api/admin/telephony", requireAuth, requireSuperAdmin, async (_req: Request, res: Response) => {
    try {
      res.json({ success: true, ...(await telephonyStatus()) });
    } catch (error) {
      logger.error("Telephony", "status failed", error as Error);
      res.status(500).json({ success: false, message: "Couldn't read the phone line status." });
    }
  });

  app.post("/api/admin/telephony/outbound-trunk", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    const parsed = z.object({
      provider: z.string().min(2).max(40).default("exotel"),
      name: z.string().min(2).max(80).default("Exotel"),
      address: z.string().min(3).max(200).regex(/^[A-Za-z0-9.:-]+$/, "Host name or IP, e.g. sip.example.com"),
      numbers: z.array(E164).min(1).max(50),
      username: z.string().max(120).optional(),
      password: z.string().max(200).optional(),
      transport: z.enum(["auto", "udp", "tcp", "tls"]).default("tcp"),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? "Check the details." });
    const b = parsed.data;
    try {
      const transport = { auto: SIPTransport.SIP_TRANSPORT_AUTO, udp: SIPTransport.SIP_TRANSPORT_UDP, tcp: SIPTransport.SIP_TRANSPORT_TCP, tls: SIPTransport.SIP_TRANSPORT_TLS }[b.transport];
      const trunk = await sipClient().createSipOutboundTrunk(b.name, b.address, b.numbers, {
        transport,
        // Calls originate from LiveKit's India region (Indian rules: telecom traffic should stay in India).
        destinationCountry: "in",
        ...(b.username ? { authUsername: b.username, authPassword: b.password ?? "" } : {}),
      });
      const previous = getLiveKitOutboundTrunkId();
      await db.execute(sql`INSERT INTO "telephony_trunks" ("direction","provider","livekit_trunk_id","name","address","numbers","created_by")
        VALUES ('outbound', ${b.provider}, ${trunk.sipTrunkId}, ${b.name}, ${b.address}, ${JSON.stringify(b.numbers)}::jsonb, ${req.user!.id})`);
      setLiveKitOutboundTrunkId(trunk.sipTrunkId);
      if (previous && previous !== trunk.sipTrunkId) {
        await sipClient().deleteSipTrunk(previous).catch((e) => logger.warn("Telephony", `old trunk delete failed: ${String(e)}`));
        await db.execute(sql`DELETE FROM "telephony_trunks" WHERE "livekit_trunk_id" = ${previous}`);
      }
      void createAuditLog({ userId: req.user!.id, action: "create", entityType: "telephony_trunk", metadata: { provider: b.provider, address: b.address, numbers: b.numbers.map(mask) } }).catch(() => {});
      res.json({ success: true, trunkId: trunk.sipTrunkId });
    } catch (error) {
      logger.error("Telephony", "outbound trunk create failed", error as Error);
      res.status(502).json({ success: false, message: `LiveKit refused the line: ${String((error as Error).message ?? error).slice(0, 140)}` });
    }
  });

  app.delete("/api/admin/telephony/outbound-trunk", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    const id = getLiveKitOutboundTrunkId();
    if (!id) return res.json({ success: true });
    try {
      await sipClient().deleteSipTrunk(id).catch(() => {});
      await db.execute(sql`DELETE FROM "telephony_trunks" WHERE "livekit_trunk_id" = ${id}`);
      setLiveKitOutboundTrunkId(null);
      void createAuditLog({ userId: req.user!.id, action: "delete", entityType: "telephony_trunk", metadata: { trunkId: id } }).catch(() => {});
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, message: "Couldn't remove the line." });
    }
  });

  app.post("/api/admin/telephony/inbound/sync", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    const parsed = z.object({
      allowedAddresses: z.array(z.string().regex(/^[0-9a-fA-F.:/]+$/, "IP address or range, e.g. 103.5.12.0/24")).max(50).optional(),
      authUsername: z.string().max(120).optional(),
      authPassword: z.string().max(200).optional(),
    }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? "Check the details." });
    try {
      const r = await syncInboundNumbers(parsed.data);
      void createAuditLog({ userId: req.user!.id, action: "update", entityType: "telephony_inbound", metadata: { numbers: r.numbers.map(mask), secured: Boolean(parsed.data.allowedAddresses?.length || parsed.data.authUsername) } }).catch(() => {});
      res.json({ success: true, ...r, numbers: r.numbers.map(mask) });
    } catch (error) {
      logger.error("Telephony", "inbound sync failed", error as Error);
      res.status(502).json({ success: false, message: `LiveKit refused: ${String((error as Error).message ?? error).slice(0, 140)}` });
    }
  });

  /** A business's own phone calls (newest first). */
  app.get("/api/business/:businessId/phone-calls", requireAuth, async (req: Request, res: Response) => {
    const businessId = Number(req.params.businessId);
    const u = req.user as any;
    const allowed = u?.role === "super_admin" || (u?.organizationId === businessId && (u?.role === "company_admin" || u?.role === "agent"));
    if (!Number.isSafeInteger(businessId) || !allowed) return res.status(403).json({ success: false, message: "Not allowed." });
    const calls = await listRecentCDRsForOrg(businessId, Math.min(200, Number(req.query.limit) || 50));
    const numbers = await db.select({ id: orgDIDNumbers.id, phoneNumber: orgDIDNumbers.phoneNumber, label: orgDIDNumbers.label, type: orgDIDNumbers.type, isActive: orgDIDNumbers.isActive })
      .from(orgDIDNumbers).where(eq(orgDIDNumbers.organizationId, businessId));
    res.json({ success: true, numbers, calls, phoneLineReady: Boolean(getLiveKitOutboundTrunkId()) });
  });
}
