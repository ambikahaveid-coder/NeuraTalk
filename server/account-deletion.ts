/**
 * Delete my account (self-service, from the app). Required by India's DPDP
 * Act (right to erasure) and Google Play's account-deletion policy.
 *
 * The account is removed the way messaging apps do it: the person's
 * identity is erased (number, email, name, photo, voice clone, devices,
 * sessions) and the account can never sign in again, while messages already
 * delivered stay with the people who received them -- deleting your account
 * must not wipe someone else's chat history. Businesses can no longer reach
 * the person (their customer records are unlinked).
 *
 * Before this, "delete request" only stored a pending row that nothing ever
 * processed.
 */
import type { Express, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import {
  customers,
  dataSubjectRequests,
  organizations,
  registeredDevices,
  users,
  voiceProfiles,
  voiceSamples,
  DATA_REQUEST_STATUS,
  DATA_REQUEST_TYPE,
} from "@shared/schema";
import { loadUser, requireAuth, invalidateAllSessionsForUser } from "./role-middleware";
import { logger } from "./observability";
import { AuditHelpers } from "./audit";

export class AccountDeletionRefusedError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "AccountDeletionRefusedError";
  }
}

/** Removes the person's cloned voice at the provider and their voice samples. */
async function deleteVoiceData(userId: number): Promise<void> {
  const profiles = await db.select().from(voiceProfiles).where(eq(voiceProfiles.userId, userId));
  for (const profile of profiles) {
    if (profile.voiceId?.startsWith("eleven_")) {
      const { deleteElevenLabsVoice } = await import("./voice-cloning-service");
      await deleteElevenLabsVoice(profile.voiceId.replace("eleven_", ""));
    }
  }
  const samples = await db.select().from(voiceSamples).where(eq(voiceSamples.userId, userId));
  if (samples.length) {
    const { decrypt } = await import("./voice-training");
    const { ObjectStorageService } = await import("./ai_integrations/object_storage");
    const storage = new ObjectStorageService();
    for (const sample of samples) {
      try {
        await (await storage.getObjectEntityFile(decrypt(sample.objectPath))).delete();
      } catch (error) {
        logger.warn("AccountDeletion", `voice sample file not removed: ${String(error)}`);
      }
    }
  }
  await db.delete(voiceSamples).where(eq(voiceSamples.userId, userId));
  await db.delete(voiceProfiles).where(eq(voiceProfiles.userId, userId));
}

export async function deleteAccount(userId: number, reason?: string): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user || !user.isActive) throw new AccountDeletionRefusedError("NOT_FOUND", "Account not found");
  if (user.role === "super_admin") {
    throw new AccountDeletionRefusedError("SUPER_ADMIN", "Platform administrator accounts are removed by another administrator.");
  }

  // A business owner with teammates hands the business over first; a sole
  // owner's business closes with the account.
  let closeBusinessId: number | null = null;
  if (user.organizationId && user.role === "company_admin") {
    const team = await db.select({ id: users.id, role: users.role }).from(users)
      .where(and(eq(users.organizationId, user.organizationId), eq(users.isActive, true)));
    const otherAdmins = team.filter((m) => m.id !== userId && m.role === "company_admin");
    const others = team.filter((m) => m.id !== userId);
    if (others.length > 0 && otherAdmins.length === 0) {
      throw new AccountDeletionRefusedError(
        "LAST_BUSINESS_ADMIN",
        "You are the only admin of your business. Make another team member an admin first, or contact support to close the business.",
      );
    }
    if (others.length === 0) closeBusinessId = user.organizationId;
  }

  await deleteVoiceData(userId);

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(users).set({
      username: `deleted_${userId}_${now.getTime().toString(36)}`,
      displayName: "Deleted account",
      phone: null,
      email: null,
      password: null,
      avatarUrl: null,
      organizationId: null,
      role: "consumer",
      isActive: false,
      pushNotificationsEnabled: false,
    }).where(eq(users.id, userId));
    await tx.delete(registeredDevices).where(eq(registeredDevices.userId, userId));
    // Businesses can no longer reach this person inside NeuraTalk.
    await tx.update(customers).set({ linkedUserId: null, updatedAt: now }).where(eq(customers.linkedUserId, userId));
    if (closeBusinessId) {
      await tx.update(organizations).set({ status: "deactivated", isActive: false, deactivatedAt: now, deactivationReason: "Owner deleted their account" })
        .where(eq(organizations.id, closeBusinessId));
    }
    await tx.insert(dataSubjectRequests).values({
      userId,
      requestType: DATA_REQUEST_TYPE.DELETION,
      status: DATA_REQUEST_STATUS.COMPLETED,
      requestDetails: { reason: reason?.slice(0, 500) || "Deleted from the app", selfService: true, closedBusinessId: closeBusinessId },
      completedAt: now,
    });
  });
  await invalidateAllSessionsForUser(userId);
  await AuditHelpers.logDelete(userId, "user_account", userId, { selfService: true, closedBusinessId: closeBusinessId }).catch(() => undefined);
  logger.info("AccountDeletion", "Account deleted by its owner", { userId, closedBusinessId: closeBusinessId });
}

export function registerAccountDeletionRoutes(app: Express): void {
  app.post("/api/account/delete", loadUser, requireAuth, async (req: Request, res: Response) => {
    if (req.body?.confirm !== "DELETE") {
      return res.status(400).json({ success: false, error: "Type DELETE to confirm" });
    }
    try {
      await deleteAccount(req.user!.id, typeof req.body?.reason === "string" ? req.body.reason : undefined);
      return res.json({ success: true });
    } catch (error) {
      if (error instanceof AccountDeletionRefusedError) {
        return res.status(409).json({ success: false, code: error.code, error: error.message });
      }
      logger.error("AccountDeletion", "Account deletion failed", error as Error);
      return res.status(500).json({ success: false, error: "Could not delete the account. Please try again or contact support." });
    }
  });
}
