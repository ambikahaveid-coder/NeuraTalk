import type { Express, Request, Response } from "express";
import { db } from "./db";
import { voiceSamples, voiceProfiles } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { ObjectStorageService } from "./ai_integrations/object_storage";
import crypto from "crypto";
import { loadUser, requireAuth, requireSuperAdmin } from "./role-middleware";
import { AuditHelpers } from "./audit";
import { recordVoiceCloneCounter } from "./voice-clone-metrics";
import { runWithTrace } from "./request-context";

const objectStorage = new ObjectStorageService();

const ENCRYPTION_ALGORITHM = "aes-256-gcm";

function getEncryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET environment variable is required for voice data encryption");
  }
  return crypto.scryptSync(secret, "voice-training-salt", 32);
}

// Exported (not just for internal use) so this logic is directly unit
// testable — no other behavior change.
export function encrypt(text: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

export function decrypt(encryptedText: string): string {
  const [ivHex, authTagHex, encrypted] = encryptedText.split(":");
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export function registerVoiceTrainingRoutes(app: Express): void {
  app.post("/api/voice-training/request-upload", loadUser, requireAuth, async (req: Request, res: Response) => {
    try {
      const { consent } = req.body;

      if (!consent) {
        return res.status(400).json({ error: "User consent is required for voice sample upload" });
      }

      const uploadURL = await objectStorage.getObjectEntityUploadURL();
      const objectPath = objectStorage.normalizeObjectEntityPath(uploadURL);
      const encryptedPath = encrypt(objectPath);

      res.json({
        uploadURL,
        objectPath: encryptedPath,
        message: "Upload your voice sample directly to the uploadURL",
      });
    } catch (error) {
      console.error("Error generating upload URL:", error);
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  });

  app.post("/api/voice-training/samples", loadUser, requireAuth, async (req: Request, res: Response) => {
    try {
      const { objectPath, transcript, duration, consent, metadata } = req.body;
      const userId = req.user!.id;

      if (!objectPath) {
        return res.status(400).json({ error: "Object path is required" });
      }

      if (!consent) {
        return res.status(400).json({ error: "User consent is required" });
      }

      const sample = await db.insert(voiceSamples).values({
        userId,
        objectPath,
        transcript,
        duration,
        consentGiven: true,
        consentTimestamp: new Date(),
        metadata: metadata || {},
        status: "pending",
      }).returning();

      recordVoiceCloneCounter("samples_uploaded");
      res.status(201).json({
        id: sample[0].id,
        message: "Voice sample recorded successfully",
      });
    } catch (error) {
      recordVoiceCloneCounter("sample_upload_failed");
      console.error("Error saving voice sample:", error);
      res.status(500).json({ error: "Failed to save voice sample" });
    }
  });

  app.get("/api/voice-training/samples/:userId", loadUser, requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = parseInt(req.params.userId);
      if (req.user!.role !== "super_admin" && req.user!.id !== userId) {
        return res.status(403).json({ error: "Unauthorized to view these voice samples" });
      }

      const samples = await db.select({
        id: voiceSamples.id,
        duration: voiceSamples.duration,
        transcript: voiceSamples.transcript,
        status: voiceSamples.status,
        createdAt: voiceSamples.createdAt,
      }).from(voiceSamples).where(eq(voiceSamples.userId, userId));

      res.json(samples);
    } catch (error) {
      console.error("Error fetching voice samples:", error);
      res.status(500).json({ error: "Failed to fetch voice samples" });
    }
  });

  app.delete("/api/voice-training/samples/:sampleId", loadUser, requireAuth, async (req: Request, res: Response) => {
    try {
      const sampleId = parseInt(req.params.sampleId);
      const userId = req.user!.id;

      const sample = await db.select().from(voiceSamples)
        .where(and(eq(voiceSamples.id, sampleId), eq(voiceSamples.userId, userId)));

      if (sample.length === 0) {
        return res.status(404).json({ error: "Voice sample not found or unauthorized" });
      }

      try {
        const decryptedPath = decrypt(sample[0].objectPath);
        const file = await objectStorage.getObjectEntityFile(decryptedPath);
        await file.delete();
      } catch (storageError) {
        console.error("Error deleting from storage:", storageError);
      }

      await db.delete(voiceSamples).where(eq(voiceSamples.id, sampleId));

      res.json({ message: "Voice sample deleted successfully" });
    } catch (error) {
      console.error("Error deleting voice sample:", error);
      res.status(500).json({ error: "Failed to delete voice sample" });
    }
  });

  app.delete("/api/voice-training/delete-all/:userId", loadUser, requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = parseInt(req.params.userId);
      const { confirmDelete } = req.body;
      if (req.user!.role !== "super_admin" && req.user!.id !== userId) {
        return res.status(403).json({ error: "Unauthorized to delete this voice data" });
      }

      if (!confirmDelete) {
        return res.status(400).json({ 
          error: "Please confirm deletion by setting confirmDelete: true",
          message: "This will permanently delete all your voice samples and trained voice data"
        });
      }

      const samples = await db.select().from(voiceSamples).where(eq(voiceSamples.userId, userId));

      for (const sample of samples) {
        try {
          const decryptedPath = decrypt(sample.objectPath);
          const file = await objectStorage.getObjectEntityFile(decryptedPath);
          await file.delete();
        } catch (storageError) {
          console.error("Error deleting sample from storage:", storageError);
        }
      }

      // Also delete the trained voice at the cloning provider itself —
      // otherwise "delete all voice data" leaves the actual clone hosted at
      // ElevenLabs, contradicting the privacy-info endpoint's claim below.
      const profiles = await db.select().from(voiceProfiles)
        .where(and(eq(voiceProfiles.userId, userId), eq(voiceProfiles.isCustom, true)));
      for (const p of profiles) {
        if (p.voiceId?.startsWith("eleven_")) {
          const { deleteElevenLabsVoice } = await import("./voice-cloning-service");
          await deleteElevenLabsVoice(p.voiceId.replace("eleven_", ""));
        }
      }

      await db.delete(voiceSamples).where(eq(voiceSamples.userId, userId));

      await db.update(voiceProfiles)
        .set({ 
          isCustom: false, 
          trainingStatus: "pending",
          voiceId: "alloy"
        })
        .where(eq(voiceProfiles.userId, userId));

      recordVoiceCloneCounter("profiles_deleted_all");
      res.json({
        message: "All voice data deleted successfully",
        deletedSamples: samples.length
      });
    } catch (error) {
      console.error("Error deleting all voice data:", error);
      res.status(500).json({ error: "Failed to delete voice data" });
    }
  });

  app.post("/api/voice-training/train/:userId", loadUser, requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = parseInt(req.params.userId);
      if (req.user!.role !== "super_admin" && req.user!.id !== userId) {
        return res.status(403).json({ error: "Unauthorized to train this voice profile" });
      }

      const samples = await db.select().from(voiceSamples)
        .where(and(eq(voiceSamples.userId, userId), eq(voiceSamples.consentGiven, true)));

      if (samples.length < 3) {
        return res.status(400).json({ 
          error: "Insufficient samples",
          message: "Please record at least 3 voice samples for training",
          currentSamples: samples.length
        });
      }

      const existingProfile = await db.select().from(voiceProfiles)
        .where(and(eq(voiceProfiles.userId, userId), eq(voiceProfiles.isCustom, true)));

      let profileId: number;

      if (existingProfile.length > 0) {
        await db.update(voiceProfiles)
          .set({ trainingStatus: "training" })
          .where(eq(voiceProfiles.id, existingProfile[0].id));
        profileId = existingProfile[0].id;
      } else {
        const newProfile = await db.insert(voiceProfiles).values({
          userId,
          name: "My Custom Voice",
          voiceId: `custom_${userId}_${Date.now()}`,
          isCustom: true,
          trainingStatus: "training",
          // Stays disabled until an admin approves it via moderation, even
          // after training succeeds — see moderationStatus default "pending".
          isEnabled: false,
        }).returning();
        profileId = newProfile[0].id;
      }

      await db.update(voiceSamples)
        .set({ voiceProfileId: profileId })
        .where(eq(voiceSamples.userId, userId));

      // Real training: Try ElevenLabs voice creation, then mark status honestly.
      // Runs detached from the request (fire-and-forget), so it gets its own
      // trace context ("voice-clone:training:<profileId>") rather than
      // inheriting the HTTP request's — the request returns immediately
      // while this continues in the background.
      void runWithTrace("voice-clone", `training:${profileId}`, async () => {
        try {
          const { enrollElevenLabsVoice } = await import("./voice-cloning-service");
          const samples = await db.select().from(voiceSamples)
            .where(eq(voiceSamples.voiceProfileId, profileId));

          if (samples.length > 0) {
            // Download audio buffers from object storage
            const buffers: Buffer[] = [];
            for (const sample of samples) {
              try {
                const decryptedPath = decrypt(sample.objectPath);
                const file = await objectStorage.getObjectEntityFile(decryptedPath);
                const [buffer] = await file.download();
                if (buffer && buffer.length > 0) buffers.push(buffer);
              } catch (dlErr) {
                console.warn(`[VoiceTraining] Failed to download sample ${sample.id}:`, dlErr);
              }
            }

            if (buffers.length > 0) {
              try {
                const { voiceId } = await enrollElevenLabsVoice(buffers, `NeuraTalk_User_${userId}`);
                await db.update(voiceProfiles)
                  .set({ trainingStatus: "ready", voiceId: `eleven_${voiceId}` })
                  .where(eq(voiceProfiles.id, profileId));

                await db.update(voiceSamples)
                  .set({ status: "processed" })
                  .where(eq(voiceSamples.voiceProfileId, profileId));

                console.log(`[VoiceTraining] ✅ ElevenLabs voice created: ${voiceId}`);
                return;
              } catch (elError) {
                console.warn(`[VoiceTraining] ElevenLabs enrollment failed: ${String(elError)}`);
              }
            } else {
              console.warn(`[VoiceTraining] No audio files could be downloaded from storage`);
            }
          }

          // No ElevenLabs or failed — mark as pending (honest: not "ready")
          await db.update(voiceProfiles)
            .set({ trainingStatus: "pending_gpu" })
            .where(eq(voiceProfiles.id, profileId));

          console.log(`[VoiceTraining] No ElevenLabs available, marked as pending_gpu`);
        } catch (err) {
          recordVoiceCloneCounter("training_failed");
          console.error("[VoiceTraining] Training error:", err);
          await db.update(voiceProfiles)
            .set({ trainingStatus: "failed" })
            .where(eq(voiceProfiles.id, profileId));
        }
      });

      recordVoiceCloneCounter("trainings_started");
      res.json({
        message: "Voice training started",
        profileId,
        estimatedTime: "2-5 minutes",
      });
    } catch (error) {
      console.error("Error starting voice training:", error);
      res.status(500).json({ error: "Failed to start voice training" });
    }
  });

  app.get("/api/voice-training/profile/:userId", loadUser, requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = parseInt(req.params.userId);
      if (req.user!.role !== "super_admin" && req.user!.id !== userId) {
        return res.status(403).json({ error: "Unauthorized to view this voice profile" });
      }

      const profile = await db.select().from(voiceProfiles)
        .where(and(eq(voiceProfiles.userId, userId), eq(voiceProfiles.isCustom, true)));

      if (profile.length === 0) {
        return res.json({ 
          hasCustomVoice: false,
          message: "No custom voice profile found"
        });
      }

      const sampleCount = await db.select().from(voiceSamples)
        .where(eq(voiceSamples.userId, userId));

      res.json({
        hasCustomVoice: true,
        profile: {
          id: profile[0].id,
          name: profile[0].name,
          isEnabled: profile[0].isEnabled,
          trainingStatus: profile[0].trainingStatus,
          createdAt: profile[0].createdAt,
        },
        sampleCount: sampleCount.length,
      });
    } catch (error) {
      console.error("Error fetching voice profile:", error);
      res.status(500).json({ error: "Failed to fetch voice profile" });
    }
  });

  app.patch("/api/voice-training/profile/:userId/toggle", loadUser, requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = parseInt(req.params.userId);
      if (req.user!.role !== "super_admin" && req.user!.id !== userId) {
        return res.status(403).json({ error: "Unauthorized to modify this voice profile" });
      }
      const { enabled } = req.body;

      // A user can always turn their own clone off, but can only turn it back
      // on if it has passed moderation — otherwise this toggle would let an
      // unreviewed or rejected clone bypass the review gate.
      const [existing] = await db.select().from(voiceProfiles)
        .where(and(eq(voiceProfiles.userId, userId), eq(voiceProfiles.isCustom, true)));
      if (!existing) {
        return res.status(404).json({ error: "No custom voice profile found" });
      }
      if (enabled && existing.moderationStatus !== "approved" && req.user!.role !== "super_admin") {
        return res.status(403).json({ error: "This voice profile has not been approved yet and cannot be enabled." });
      }

      const result = await db.update(voiceProfiles)
        .set({ isEnabled: enabled })
        .where(and(eq(voiceProfiles.userId, userId), eq(voiceProfiles.isCustom, true)))
        .returning();

      res.json({
        message: enabled ? "Custom voice enabled" : "Custom voice disabled",
        isEnabled: result[0]?.isEnabled ?? enabled,
      });
    } catch (error) {
      console.error("Error toggling voice profile:", error);
      res.status(500).json({ error: "Failed to toggle voice profile" });
    }
  });

  // === Admin moderation ===
  // A voice profile reaching trainingStatus "ready" is not usable in a real
  // call until an admin approves it here — enforced by isEnabled defaulting
  // to false on creation (see /train above) and by the moderationStatus
  // check in server/modules/calls/controller.ts's translateNatural handler.
  app.get("/api/voice-training/admin/pending-review", loadUser, requireAuth, requireSuperAdmin, async (_req: Request, res: Response) => {
    try {
      const pending = await db.select().from(voiceProfiles)
        .where(and(eq(voiceProfiles.trainingStatus, "ready"), eq(voiceProfiles.moderationStatus, "pending")));
      res.json({ profiles: pending });
    } catch (error) {
      console.error("Error listing pending voice profiles:", error);
      res.status(500).json({ error: "Failed to list pending voice profiles" });
    }
  });

  app.post("/api/voice-training/admin/:profileId/moderate", loadUser, requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
      const profileId = parseInt(req.params.profileId);
      const { approve, notes } = req.body as { approve?: boolean; notes?: string };
      if (typeof approve !== "boolean") {
        return res.status(400).json({ error: "'approve' (boolean) is required" });
      }

      const [existing] = await db.select().from(voiceProfiles).where(eq(voiceProfiles.id, profileId));
      if (!existing) return res.status(404).json({ error: "Voice profile not found" });

      const [updated] = await db.update(voiceProfiles)
        .set({
          moderationStatus: approve ? "approved" : "rejected",
          moderationReviewedBy: req.user!.id,
          moderationReviewedAt: new Date(),
          moderationNotes: notes ?? null,
          isEnabled: approve,
        })
        .where(eq(voiceProfiles.id, profileId))
        .returning();

      await AuditHelpers.logUpdate(req.user!.id, "voice_profile_moderation", profileId,
        { moderationStatus: existing.moderationStatus },
        { moderationStatus: updated.moderationStatus, notes: notes ?? null },
      );

      recordVoiceCloneCounter(approve ? "moderation_approved" : "moderation_rejected");
      res.json({ profile: updated });
    } catch (error) {
      console.error("Error moderating voice profile:", error);
      res.status(500).json({ error: "Failed to moderate voice profile" });
    }
  });

  app.get("/api/voice-training/privacy-info", async (_req: Request, res: Response) => {
    res.json({
      encryption: "AES-256-GCM encryption for all voice samples",
      storage: "Voice data stored in isolated user-specific containers",
      isolation: "No voice samples shared or used across users",
      deletion: "Users can delete all voice data at any time",
      consent: "Explicit consent required before any voice sample upload",
      training: "Voice models are user-specific and never combined",
    });
  });
}
