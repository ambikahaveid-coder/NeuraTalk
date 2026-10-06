import { Router } from "express";
import { db } from "./db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { logger } from "./observability";
import { loadUser, requireAuth } from "./role-middleware";

const router = Router();

/**
 * Persist user legal consents for regulatory compliance (DPDP/GDPR)
 */
// Consent is always recorded for the signed-in user; a userId in the body is
// accepted only when it matches, so one account cannot change another's consent.
router.post("/api/compliance/consent", loadUser, requireAuth, async (req, res) => {
  try {
    const { termsAccepted, translationConsent, recordingConsent } = req.body;
    const userId = req.user!.id;
    if (req.body.userId != null && Number(req.body.userId) !== userId) {
      return res.status(403).json({ error: "You can only update your own consent" });
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
router.post("/api/compliance/routing", loadUser, requireAuth, async (req, res) => {
  try {
    const { preferredRegion } = req.body;
    const userId = req.user!.id;

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
