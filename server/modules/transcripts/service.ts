/**
 * Transcript System — service layer.
 *
 * Reuses the existing `call_translations` table (shared/schema.ts) rather
 * than introducing a parallel store. That table already had real
 * persistence, a retention job, and a read endpoint wired to the LEGACY
 * bridged-call path (server/modules/calls/gateway.ts) — but the CURRENT
 * primary call path (server/translator-bot.ts, LiveKit) never wrote to it.
 * `persistTranslationSegment` below is the shared write path both the
 * legacy gateway and translator-bot now call, instead of each having its
 * own insert logic.
 */
import { and, eq, or, desc, asc, ilike, gte, sql } from "drizzle-orm";
import { db } from "../../db";
import { callTranslations, bridgedCalls, callConsents, users, type CallTranslation } from "@shared/schema";
import { logger } from "../../observability";
import { recordTranscriptCounter, recordRetentionSweepResult, recordRetentionSweepFailure } from "./metrics";

export interface TranslationSegmentInput {
  /** Legacy integer call id, if this segment came from the bridged-call path. */
  callId?: number | null;
  /** Current call model's string id (e.g. "call_<uuid>"), if from LiveKit. */
  smartCallId?: string | null;
  direction: "caller_to_receiver" | "receiver_to_caller";
  speakerIdentity?: string | null;
  targetIdentity?: string | null;
  originalText: string;
  originalLanguage: string;
  translatedText: string;
  translatedLanguage: string;
  emotionDetected?: string | null;
  emotionIntensity?: number | null;
  latencyMs?: number | null;
}

export async function persistTranslationSegment(input: TranslationSegmentInput): Promise<CallTranslation | null> {
  if (!input.callId && !input.smartCallId) {
    logger.warn("Transcripts", "persistTranslationSegment called with neither callId nor smartCallId — dropped");
    return null;
  }
  try {
    const [row] = await db.insert(callTranslations).values({
      callId: input.callId ?? null,
      smartCallId: input.smartCallId ?? null,
      direction: input.direction,
      speakerIdentity: input.speakerIdentity ?? null,
      targetIdentity: input.targetIdentity ?? null,
      originalText: input.originalText,
      originalLanguage: input.originalLanguage,
      translatedText: input.translatedText,
      translatedLanguage: input.translatedLanguage,
      emotionDetected: input.emotionDetected ?? null,
      emotionIntensity: input.emotionIntensity ?? null,
      latencyMs: input.latencyMs ?? null,
    }).returning();
    recordTranscriptCounter("segments_persisted");
    return row;
  } catch (error) {
    // Never let transcript persistence break a live call.
    recordTranscriptCounter("segments_persist_failed");
    logger.warn("Transcripts", `persistTranslationSegment failed: ${String(error)}`);
    return null;
  }
}

/**
 * Once a smart call finalizes into a `bridgedCalls` row (server/call-persistence.ts),
 * link the transcript segments that were written during the call (keyed only
 * by smartCallId at the time) to that row's integer id too. Best-effort —
 * segments remain fully queryable by smartCallId even if this never runs.
 */
export async function backfillCallIdForSmartCall(smartCallId: string, bridgedCallId: number): Promise<void> {
  try {
    await db.update(callTranslations)
      .set({ callId: bridgedCallId })
      .where(and(eq(callTranslations.smartCallId, smartCallId), sql`${callTranslations.callId} IS NULL`));
  } catch (error) {
    logger.warn("Transcripts", `backfillCallIdForSmartCall failed for ${smartCallId}: ${String(error)}`);
  }
}

function callIdentifierFilter(identifier: string | number) {
  return typeof identifier === "number" || /^\d+$/.test(identifier)
    ? eq(callTranslations.callId, Number(identifier))
    : eq(callTranslations.smartCallId, String(identifier));
}

export async function getTranscript(callIdentifier: string | number): Promise<CallTranslation[]> {
  return db.select().from(callTranslations)
    .where(callIdentifierFilter(callIdentifier))
    .orderBy(asc(callTranslations.timestamp));
}

/**
 * Resolve the owning user id(s) for a call, for RBAC checks — checks both
 * the legacy bridgedCalls row and the smart-call metadata persisted at
 * call-end (which carries callerUserId/calleeUserId as text, mirrored onto
 * bridgedCalls.callSid = smartCallId).
 */
export async function getCallOwnerUserIds(callIdentifier: string | number): Promise<number[]> {
  const isLegacyId = typeof callIdentifier === "number" || /^\d+$/.test(String(callIdentifier));
  const [call] = await db.select().from(bridgedCalls)
    .where(isLegacyId ? eq(bridgedCalls.id, Number(callIdentifier)) : eq(bridgedCalls.callSid, String(callIdentifier)));
  if (!call) return [];
  return [call.callerUserId, call.receiverUserId].filter((id): id is number => typeof id === "number");
}

export interface TranscriptSearchParams {
  query: string;
  organizationId?: number | null;
  userId?: number | null;
  /** Admin-only: narrow an org-scoped search to one specific member. */
  filterUserId?: number | null;
  dateFrom?: Date | null;
  dateTo?: Date | null;
  limit?: number;
  offset?: number;
}

export interface TranscriptSearchResult {
  results: CallTranslation[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Full-text search over transcript content. Implemented with ILIKE rather
 * than a tsvector column — no other search in this codebase uses Postgres
 * full-text search infrastructure (tsvector/GIN indexes), and introducing
 * that infrastructure for one feature was judged out of scope for this
 * pass. ILIKE is correct and simple at the data volumes this table
 * realistically holds; if transcript volume grows large enough for this to
 * matter, migrating to a tsvector + GIN index is a drop-in upgrade to this
 * one function, not a redesign.
 *
 * Serves both the consumer search (query + own userId) and the enterprise
 * admin search (query + organizationId + optional filterUserId/date range)
 * — one function, not two, since the underlying capability is identical and
 * only the scoping/filters differ.
 */
export async function searchTranscripts(params: TranscriptSearchParams): Promise<TranscriptSearchResult> {
  const pattern = `%${params.query.replace(/[%_]/g, "\\$&")}%`;
  const conditions = [or(ilike(callTranslations.originalText, pattern), ilike(callTranslations.translatedText, pattern))];
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;

  // Scope to calls the requester actually has access to. bridgedCalls has no
  // organizationId column of its own — org scoping goes through the users
  // table via caller/receiver, matching how org membership is tracked
  // everywhere else in this schema.
  if (params.organizationId) {
    const orgUsers = await db.select({ id: users.id }).from(users).where(eq(users.organizationId, params.organizationId));
    let orgUserIds = orgUsers.map((u) => u.id);
    if (params.filterUserId) {
      orgUserIds = orgUserIds.filter((id) => id === params.filterUserId);
    }
    if (orgUserIds.length === 0) return { results: [], total: 0, limit, offset };
    const orgCallIds = await db.select({ id: bridgedCalls.id }).from(bridgedCalls)
      .where(or(
        sql`${bridgedCalls.callerUserId} IN (${sql.join(orgUserIds, sql`, `)})`,
        sql`${bridgedCalls.receiverUserId} IN (${sql.join(orgUserIds, sql`, `)})`,
      ));
    const ids = orgCallIds.map((c) => c.id);
    if (ids.length === 0) return { results: [], total: 0, limit, offset };
    conditions.push(sql`${callTranslations.callId} IN (${sql.join(ids, sql`, `)})`);
  } else if (params.userId) {
    const userCallIds = await db.select({ id: bridgedCalls.id }).from(bridgedCalls)
      .where(or(eq(bridgedCalls.callerUserId, params.userId), eq(bridgedCalls.receiverUserId, params.userId)));
    const ids = userCallIds.map((c) => c.id);
    if (ids.length === 0) return { results: [], total: 0, limit, offset };
    conditions.push(sql`${callTranslations.callId} IN (${sql.join(ids, sql`, `)})`);
  }

  if (params.dateFrom) conditions.push(gte(callTranslations.timestamp, params.dateFrom));
  if (params.dateTo) conditions.push(sql`${callTranslations.timestamp} <= ${params.dateTo.toISOString()}`);

  const whereClause = and(...conditions);
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(callTranslations).where(whereClause);

  const results = await db.select().from(callTranslations)
    .where(whereClause)
    .orderBy(desc(callTranslations.timestamp))
    .limit(limit)
    .offset(offset);

  recordTranscriptCounter("searches");
  return { results, total: count, limit, offset };
}

function speakerLabel(segment: CallTranslation): string {
  if (segment.speakerIdentity) return segment.speakerIdentity;
  return segment.direction === "caller_to_receiver" ? "Caller" : "Receiver";
}

function formatTimestamp(segment: CallTranslation): string {
  return segment.timestamp ? new Date(segment.timestamp).toLocaleString() : "";
}

export function exportTranscriptAsTxt(segments: CallTranslation[]): string {
  return segments.map((s) =>
    `[${formatTimestamp(s)}] ${speakerLabel(s)} (${s.originalLanguage}): ${s.originalText}\n` +
    `  → (${s.translatedLanguage}): ${s.translatedText}`,
  ).join("\n\n");
}

export async function exportTranscriptAsPdf(segments: CallTranslation[], title: string): Promise<Buffer> {
  const PDFDocument = (await import("pdfkit")).default;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).text(title, { underline: true });
    doc.moveDown();

    for (const s of segments) {
      doc.fontSize(9).fillColor("#666").text(`${formatTimestamp(s)} — ${speakerLabel(s)}`);
      doc.fontSize(11).fillColor("#000").text(`${s.originalText}`, { paragraphGap: 2 });
      doc.fontSize(10).fillColor("#333").text(`→ ${s.translatedText}`, { paragraphGap: 8 });
      doc.moveDown(0.5);
    }

    doc.end();
  });
}

export async function exportTranscriptAsDocx(segments: CallTranslation[], title: string): Promise<Buffer> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import("docx");

  const children = [
    new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }),
    ...segments.flatMap((s) => [
      new Paragraph({
        children: [
          new TextRun({ text: `${formatTimestamp(s)} — ${speakerLabel(s)}`, italics: true, size: 18, color: "666666" }),
        ],
      }),
      new Paragraph({ children: [new TextRun({ text: s.originalText })] }),
      new Paragraph({ children: [new TextRun({ text: `→ ${s.translatedText}`, color: "333333" })] }),
      new Paragraph({ text: "" }),
    ]),
  ];

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}

export async function deleteTranscript(callIdentifier: string | number): Promise<number> {
  const result = await db.delete(callTranslations).where(callIdentifierFilter(callIdentifier));
  recordTranscriptCounter("deletions");
  return result.rowCount ?? 0;
}

/**
 * Retention window per `callConsents.dataRetention` value.
 *
 * Interpretation (a product-policy call this pass makes explicit rather
 * than leaving unimplemented — confirm/adjust with product if this isn't
 * the intended meaning):
 *   "none"    — no explicit preference set → falls back to the platform
 *               default (30 days), matching the previous global policy so
 *               this change doesn't silently start deleting more data than
 *               before for users who never chose a preference.
 *   "session" — most aggressive opt-in: purged on the next sweep after the
 *               call ends. This is a periodic batch sweep, not a real-time
 *               delete-at-hangup hook — "session" data can persist for up
 *               to one sweep interval (24h) after the call ends.
 *   "7days" / "30days" — explicit windows.
 */
const RETENTION_DAYS: Record<string, number> = {
  none: 30,
  session: 0,
  "7days": 7,
  "30days": 30,
};

/**
 * Retention sweep that respects each user's `callConsents.dataRetention`
 * preference instead of the previous hard-coded global 30-day policy.
 * Replaces cleanup-job.ts's transcript/call purge logic — this is not a
 * second job running alongside it.
 */
export async function purgeExpiredTranscripts(): Promise<{ purgedCalls: number; purgedSegments: number }> {
  const consentRows = await db.select().from(callConsents);
  const now = Date.now();
  let purgedCalls = 0;
  let purgedSegments = 0;

  const usersByTier = new Map<string, number[]>();
  for (const consent of consentRows) {
    const tier = consent.dataRetention ?? "none";
    if (!(tier in RETENTION_DAYS)) continue; // unknown value — conservative, skip rather than guess
    const list = usersByTier.get(tier) ?? [];
    list.push(consent.userId);
    usersByTier.set(tier, list);
  }

  for (const [tier, userIds] of Array.from(usersByTier.entries())) {
    if (userIds.length === 0) continue;
    const cutoff = new Date(now - RETENTION_DAYS[tier] * 24 * 60 * 60 * 1000);

    const staleCalls = await db.select({ id: bridgedCalls.id }).from(bridgedCalls)
      .where(and(
        or(...userIds.map((uid) => or(eq(bridgedCalls.callerUserId, uid), eq(bridgedCalls.receiverUserId, uid)))),
        sql`${bridgedCalls.startedAt} < ${cutoff.toISOString()}`,
      ));
    if (staleCalls.length === 0) continue;

    const ids = staleCalls.map((c) => c.id);
    const segResult = await db.delete(callTranslations).where(sql`${callTranslations.callId} IN (${sql.join(ids, sql`, `)})`);
    purgedSegments += segResult.rowCount ?? 0;
    const callResult = await db.delete(bridgedCalls).where(sql`${bridgedCalls.id} IN (${sql.join(ids, sql`, `)})`);
    purgedCalls += callResult.rowCount ?? 0;
  }

  // Users with no callConsents row at all still get the platform default —
  // matches the previous global-30-day behavior for every call that isn't
  // covered by a per-user preference above.
  const usersWithConsent = new Set(consentRows.map((c) => c.userId));
  const defaultCutoff = new Date(now - RETENTION_DAYS.none * 24 * 60 * 60 * 1000);
  const staleUncoveredCalls = await db.select({ id: bridgedCalls.id, callerUserId: bridgedCalls.callerUserId, receiverUserId: bridgedCalls.receiverUserId })
    .from(bridgedCalls)
    .where(sql`${bridgedCalls.startedAt} < ${defaultCutoff.toISOString()}`);
  const uncoveredIds = staleUncoveredCalls
    .filter((c) => !usersWithConsent.has(c.callerUserId ?? -1) && !usersWithConsent.has(c.receiverUserId ?? -1))
    .map((c) => c.id);
  if (uncoveredIds.length > 0) {
    const segResult = await db.delete(callTranslations).where(sql`${callTranslations.callId} IN (${sql.join(uncoveredIds, sql`, `)})`);
    purgedSegments += segResult.rowCount ?? 0;
    const callResult = await db.delete(bridgedCalls).where(sql`${bridgedCalls.id} IN (${sql.join(uncoveredIds, sql`, `)})`);
    purgedCalls += callResult.rowCount ?? 0;
  }

  return { purgedCalls, purgedSegments };
}
