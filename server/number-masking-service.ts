import { and, asc, eq, lt } from "drizzle-orm";
import { db } from "./db";
import {
  communicationMaskedNumberMappings,
  communicationVirtualNumbers,
  type CommunicationMaskedNumberMapping,
} from "@shared/schema";

const DEFAULT_MASKING_TTL_MINUTES = Math.max(5, Number(process.env.COMMUNICATION_MASKING_TTL_MINUTES || 120));

export interface AssignMaskedNumberInput {
  sessionId: string;
  apiKeyId: number;
  organizationId: number;
  callerExternalId?: string | null;
  calleeExternalId?: string | null;
  callerRealNumber: string;
  calleeRealNumber: string;
  region?: string;
  ttlMinutes?: number;
  metadata?: Record<string, unknown>;
}

export async function assignMaskedNumber(input: AssignMaskedNumberInput): Promise<CommunicationMaskedNumberMapping> {
  const ttlMinutes = Math.max(5, input.ttlMinutes ?? DEFAULT_MASKING_TTL_MINUTES);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);

  const [virtualNumber] = await db.select()
    .from(communicationVirtualNumbers)
    .where(and(
      eq(communicationVirtualNumbers.status, "available"),
      eq(communicationVirtualNumbers.region, input.region || "ap-south-1"),
    ))
    .orderBy(asc(communicationVirtualNumbers.lastAssignedAt), asc(communicationVirtualNumbers.id))
    .limit(1);

  const maskedNumber = virtualNumber?.phoneNumber || `masked-${input.sessionId.slice(-8)}`;

  if (virtualNumber) {
    await db.update(communicationVirtualNumbers)
      .set({
        status: "assigned",
        lastAssignedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(communicationVirtualNumbers.id, virtualNumber.id));
  }

  const [mapping] = await db.insert(communicationMaskedNumberMappings)
    .values({
      sessionId: input.sessionId,
      virtualNumberId: virtualNumber?.id,
      apiKeyId: input.apiKeyId,
      organizationId: input.organizationId,
      callerExternalId: input.callerExternalId ?? null,
      calleeExternalId: input.calleeExternalId ?? null,
      callerRealNumber: input.callerRealNumber,
      calleeRealNumber: input.calleeRealNumber,
      maskedNumber,
      expiresAt,
      metadata: input.metadata ?? {},
    })
    .returning();

  return mapping;
}

export async function releaseMaskedNumber(sessionId: string): Promise<void> {
  const [mapping] = await db.select()
    .from(communicationMaskedNumberMappings)
    .where(and(
      eq(communicationMaskedNumberMappings.sessionId, sessionId),
      eq(communicationMaskedNumberMappings.status, "active"),
    ))
    .limit(1);

  if (!mapping) return;

  await db.update(communicationMaskedNumberMappings)
    .set({
      status: "released",
      releasedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(communicationMaskedNumberMappings.id, mapping.id));

  if (mapping.virtualNumberId) {
    await db.update(communicationVirtualNumbers)
      .set({
        status: "available",
        updatedAt: new Date(),
      })
      .where(eq(communicationVirtualNumbers.id, mapping.virtualNumberId));
  }
}

export async function expireMaskedNumbers(): Promise<number> {
  const expiredMappings = await db.select()
    .from(communicationMaskedNumberMappings)
    .where(and(
      eq(communicationMaskedNumberMappings.status, "active"),
      lt(communicationMaskedNumberMappings.expiresAt, new Date()),
    ));

  for (const mapping of expiredMappings) {
    await db.update(communicationMaskedNumberMappings)
      .set({
        status: "expired",
        releasedAt: mapping.releasedAt ?? new Date(),
        updatedAt: new Date(),
      })
      .where(eq(communicationMaskedNumberMappings.id, mapping.id));

    if (mapping.virtualNumberId) {
      await db.update(communicationVirtualNumbers)
        .set({
          status: "available",
          updatedAt: new Date(),
        })
        .where(eq(communicationVirtualNumbers.id, mapping.virtualNumberId));
    }
  }

  return expiredMappings.length;
}

export async function getMaskedNumberBySession(sessionId: string) {
  const [mapping] = await db.select()
    .from(communicationMaskedNumberMappings)
    .where(eq(communicationMaskedNumberMappings.sessionId, sessionId))
    .limit(1);
  return mapping;
}
