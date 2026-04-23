import { Router, Request, Response } from "express";
import { requireAuth } from "./role-middleware";
import { db } from "./db";
import { users, organizations, conversations, voiceProfiles, subscriptions, invoices, registeredDevices, userConsents, dataSubjectRequests, DATA_REQUEST_TYPE, DATA_REQUEST_STATUS } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

const router = Router();

router.get("/api/gdpr/export", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const userConversations = await db.select({
      id: conversations.id,
      title: conversations.title,
      createdAt: conversations.createdAt,
    }).from(conversations).where(eq(conversations.userId, userId));

    const userVoiceProfiles = await db.select({
      id: voiceProfiles.id,
      name: voiceProfiles.name,
      createdAt: voiceProfiles.createdAt,
    }).from(voiceProfiles).where(eq(voiceProfiles.userId, userId));

    const userSubscriptions = await db.select({
      id: subscriptions.id,
      status: subscriptions.status,
      startDate: subscriptions.startDate,
      endDate: subscriptions.endDate,
    }).from(subscriptions).where(eq(subscriptions.userId, userId));

    const userInvoices = await db.select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      subtotalPaise: invoices.subtotalPaise,
      totalAmountPaise: invoices.totalAmountPaise,
      status: invoices.status,
      createdAt: invoices.createdAt,
    }).from(invoices).where(eq(invoices.userId, userId));

    const userDevices = await db.select({
      id: registeredDevices.id,
      platform: registeredDevices.platform,
      deviceName: registeredDevices.deviceName,
      createdAt: registeredDevices.createdAt,
    }).from(registeredDevices).where(eq(registeredDevices.userId, userId));

    let orgData = null;
    if (user.organizationId) {
      const [org] = await db.select({
        id: organizations.id,
        name: organizations.name,
        plan: organizations.plan,
      }).from(organizations).where(eq(organizations.id, user.organizationId));
      orgData = org;
    }

    const exportData = {
      exportDate: new Date().toISOString(),
      exportVersion: "1.0",
      dataController: {
        name: "Mindwhile IT Solutions Pvt Ltd",
        contact: "dpo@neuratalk.com",
      },
      personalData: {
        profile: {
          id: user.id,
          username: user.username,
          email: user.email,
          phone: user.phone,
          role: user.role,
          isActive: user.isActive,
          emailVerified: user.emailVerified,
          phoneVerified: user.phoneVerified,
          lastLoginAt: user.lastLoginAt,
          createdAt: user.createdAt,
        },
        organization: orgData,
        conversations: userConversations,
        voiceProfiles: userVoiceProfiles.map(vp => ({
          ...vp,
          note: "Voice sample data is stored separately. Request deletion to remove."
        })),
        subscriptions: userSubscriptions,
        invoices: userInvoices,
        devices: userDevices,
      },
      dataCategories: {
        identifiers: ["username", "email", "phone"],
        accountData: ["role", "preferences"],
        usageData: ["conversations", "call history"],
        financialData: ["subscriptions", "invoices"],
        technicalData: ["devices", "IP addresses in logs"],
        voiceData: ["voice profiles (if enabled)"],
      },
      yourRights: {
        access: "This export fulfills your right to access",
        rectification: "Contact dpo@neuratalk.com to correct data",
        erasure: "Use the 'Delete Account' feature or contact dpo@neuratalk.com",
        portability: "This export is in machine-readable JSON format",
        restriction: "Contact dpo@neuratalk.com to restrict processing",
        objection: "Contact dpo@neuratalk.com to object to processing",
      },
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="neuratalk-data-export-${userId}-${Date.now()}.json"`);
    res.json(exportData);
  } catch (error) {
    console.error("Error exporting user data:", error);
    res.status(500).json({ error: "Failed to export data" });
  }
});

router.post("/api/gdpr/delete-request", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { reason, confirmEmail } = req.body;

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (confirmEmail && confirmEmail.toLowerCase() !== user.email?.toLowerCase()) {
      return res.status(400).json({ error: "Email confirmation does not match" });
    }

    const [existingRequest] = await db.select().from(dataSubjectRequests)
      .where(and(
        eq(dataSubjectRequests.userId, userId),
        eq(dataSubjectRequests.requestType, DATA_REQUEST_TYPE.DELETION),
        eq(dataSubjectRequests.status, DATA_REQUEST_STATUS.PENDING)
      ));

    if (existingRequest) {
      return res.status(400).json({ 
        error: "You already have a pending deletion request",
        requestId: existingRequest.id,
        requestedAt: existingRequest.createdAt,
      });
    }

    const [request] = await db.insert(dataSubjectRequests).values({
      userId,
      requestType: DATA_REQUEST_TYPE.DELETION,
      status: DATA_REQUEST_STATUS.PENDING,
      requestDetails: { reason: reason || "User requested account deletion" },
    }).returning();

    res.json({
      message: "Deletion request submitted successfully",
      requestId: request.id,
      status: "pending",
      note: "Your account will be deleted within 30 days as per GDPR/DPDP requirements. You will receive a confirmation email once complete.",
    });
  } catch (error) {
    console.error("Error creating deletion request:", error);
    res.status(500).json({ error: "Failed to submit deletion request" });
  }
});

router.get("/api/gdpr/delete-request/status", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const [request] = await db.select().from(dataSubjectRequests)
      .where(and(
        eq(dataSubjectRequests.userId, userId),
        eq(dataSubjectRequests.requestType, DATA_REQUEST_TYPE.DELETION)
      ))
      .orderBy(desc(dataSubjectRequests.createdAt))
      .limit(1);

    if (!request) {
      return res.json({ hasPendingRequest: false });
    }

    res.json({
      hasPendingRequest: request.status === DATA_REQUEST_STATUS.PENDING,
      request: {
        id: request.id,
        status: request.status,
        createdAt: request.createdAt,
        completedAt: request.completedAt,
      },
    });
  } catch (error) {
    console.error("Error fetching deletion request status:", error);
    res.status(500).json({ error: "Failed to fetch status" });
  }
});

router.delete("/api/gdpr/delete-request/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const requestId = parseInt(req.params.id);

    const [request] = await db.select().from(dataSubjectRequests)
      .where(and(
        eq(dataSubjectRequests.id, requestId),
        eq(dataSubjectRequests.userId, userId),
        eq(dataSubjectRequests.status, DATA_REQUEST_STATUS.PENDING)
      ));

    if (!request) {
      return res.status(404).json({ error: "Deletion request not found or already processed" });
    }

    await db.update(dataSubjectRequests)
      .set({ status: DATA_REQUEST_STATUS.CANCELLED, completedAt: new Date() })
      .where(eq(dataSubjectRequests.id, requestId));

    res.json({ message: "Deletion request cancelled successfully" });
  } catch (error) {
    console.error("Error cancelling deletion request:", error);
    res.status(500).json({ error: "Failed to cancel request" });
  }
});

router.get("/api/gdpr/consents", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const consents = await db.select().from(userConsents)
      .where(eq(userConsents.userId, userId));

    const consentMap: Record<string, { granted: boolean; grantedAt: Date | null }> = {};

    consents.forEach(consent => {
      consentMap[consent.consentType] = {
        granted: consent.granted,
        grantedAt: consent.grantedAt,
      };
    });

    res.json({ consents: consentMap });
  } catch (error) {
    console.error("Error fetching consents:", error);
    res.status(500).json({ error: "Failed to fetch consents" });
  }
});

router.post("/api/gdpr/consents", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { consentType, granted } = req.body;

    const validTypes = ["marketing", "analytics", "voiceTraining", "dataSharing", "cookies"];
    if (!validTypes.includes(consentType)) {
      return res.status(400).json({ error: "Invalid consent type" });
    }

    const [existing] = await db.select().from(userConsents)
      .where(and(
        eq(userConsents.userId, userId),
        eq(userConsents.consentType, consentType)
      ));

    if (existing) {
      if (granted) {
        await db.update(userConsents)
          .set({ 
            granted, 
            grantedAt: new Date(),
            revokedAt: null,
            ipAddress: req.ip || null,
          })
          .where(eq(userConsents.id, existing.id));
      } else {
        await db.update(userConsents)
          .set({ 
            granted, 
            revokedAt: new Date(),
            ipAddress: req.ip || null,
          })
          .where(eq(userConsents.id, existing.id));
      }
    } else {
      await db.insert(userConsents).values({
        userId,
        consentType,
        granted,
        version: "1.0",
        ipAddress: req.ip || null,
        grantedAt: granted ? new Date() : null,
      });
    }

    res.json({ 
      message: "Consent updated successfully",
      consentType,
      granted,
    });
  } catch (error) {
    console.error("Error updating consent:", error);
    res.status(500).json({ error: "Failed to update consent" });
  }
});

router.get("/api/gdpr/data-requests", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const requests = await db.select().from(dataSubjectRequests)
      .where(eq(dataSubjectRequests.userId, userId))
      .orderBy(desc(dataSubjectRequests.createdAt));

    res.json({ requests });
  } catch (error) {
    console.error("Error fetching data requests:", error);
    res.status(500).json({ error: "Failed to fetch requests" });
  }
});

export default router;
