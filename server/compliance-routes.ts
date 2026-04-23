import { Router } from "express";
import { db } from "./db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { logger } from "./observability";

const router = Router();

/**
 * Persist user legal consents for regulatory compliance (DPDP/GDPR)
 */
router.post("/api/compliance/consent", async (req, res) => {
  try {
    const { userId, termsAccepted, translationConsent, recordingConsent } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required for compliance logging" });
    }

    await db.update(users)
      .set({
        consentTerms: termsAccepted,
        consentTranslation: translationConsent,
        consentRecording: recordingConsent,
        consentTimestamp: new Date(),
      })
      .where(eq(users.id, userId));

    logger.info("Compliance", `User ${userId} updated legal consents`, {
      terms: termsAccepted,
      translation: translationConsent,
      recording: recordingConsent
    });

    res.json({ success: true, timestamp: new Date() });
  } catch (error) {
    logger.error("Compliance", "Failed to persist user consent", error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal compliance system error" });
  }
});

/**
 * Latency-Aware Regional Routing
 * Allows the client to specify their preferred execution node
 */
router.post("/api/compliance/routing", async (req, res) => {
  try {
    const { userId, preferredRegion } = req.body;

    await db.update(users)
      .set({ preferredRegion })
      .where(eq(users.id, userId));

    logger.info("Routing", `User ${userId} switched primary execution region to ${preferredRegion}`);

    res.json({ success: true, region: preferredRegion });
  } catch (error) {
    res.status(500).json({ error: "Failed to update routing preference" });
  }
});

export default router;
