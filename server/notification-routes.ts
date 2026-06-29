/**
 * USER NOTIFICATIONS
 *
 * Endpoints:
 *   GET  /api/notifications              – paginated list (unread first)
 *   POST /api/notifications/:id/read     – mark one read
 *   POST /api/notifications/read-all     – mark all read for user
 *   GET  /api/notifications/unread-count – badge count
 *
 * Internal helper:
 *   createNotification()                 – used by calls/payment/subscription modules
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "./db";
import { userNotifications, registeredDevices } from "@shared/schema";
import { loadUser, requireAuth } from "./role-middleware";
import { logger } from "./observability";
import { sendPushNotification } from "./firebase-admin";

// ─── Schema ─────────────────────────────────────────────────────────────────

const NOTIFICATION_TYPES = [
  "missed_call",
  "incoming_call",
  "call_ended",
  "payment_success",
  "payment_failed",
  "subscription_expiry",
  "wallet_low",
  "system",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface CreateNotificationInput {
  userId: number;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

// ─── Internal helper ─────────────────────────────────────────────────────────

export async function createNotification(input: CreateNotificationInput): Promise<void> {
  try {
    const [row] = await db.insert(userNotifications).values({
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      data: input.data ?? {},
      isRead: false,
      deliveredViaPush: false,
    }).returning({ id: userNotifications.id });

    // Fire-and-forget FCM push
    sendPushNotification(input.userId, {
      title: input.title,
      body: input.body,
      data: { type: input.type, notificationId: String(row?.id ?? 0), ...(input.data ? Object.fromEntries(Object.entries(input.data).map(([k, v]) => [k, String(v)])) : {}) },
    }).then(({ sent }) => {
      if (sent > 0 && row?.id) {
        db.update(userNotifications).set({ deliveredViaPush: true }).where(eq(userNotifications.id, row.id)).catch(() => {});
      }
    }).catch(() => {});
  } catch (err) {
    logger.error("Notifications", `Failed to create notification for user ${input.userId}`, err as Error);
  }
}

// ─── Route registration ──────────────────────────────────────────────────────

export function registerNotificationRoutes(app: Express): void {

  // GET /api/notifications
  app.get("/api/notifications", loadUser, requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const limit = Math.min(Number(req.query.limit) || 30, 100);
      const offset = Math.max(Number(req.query.offset) || 0, 0);
      const unreadOnly = req.query.unread === "true";

      const conditions = unreadOnly
        ? [eq(userNotifications.userId, userId), eq(userNotifications.isRead, false)]
        : [eq(userNotifications.userId, userId)];

      const rows = await db
        .select()
        .from(userNotifications)
        .where(and(...conditions))
        .orderBy(desc(userNotifications.createdAt))
        .limit(limit)
        .offset(offset);

      const [{ total }] = await db
        .select({ total: sql<number>`cast(count(*) as int)` })
        .from(userNotifications)
        .where(and(...conditions));

      const [{ unread }] = await db
        .select({ unread: sql<number>`cast(count(*) as int)` })
        .from(userNotifications)
        .where(and(eq(userNotifications.userId, userId), eq(userNotifications.isRead, false)));

      return res.json({
        success: true,
        notifications: rows,
        unreadCount: unread,
        pagination: { total, limit, offset },
      });
    } catch (err) {
      logger.error("Notifications", "Failed to fetch notifications", err as Error);
      return res.status(500).json({ success: false, message: "Failed to fetch notifications" });
    }
  });

  // GET /api/notifications/unread-count
  app.get("/api/notifications/unread-count", loadUser, requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const [{ count }] = await db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(userNotifications)
        .where(and(eq(userNotifications.userId, userId), eq(userNotifications.isRead, false)));

      return res.json({ success: true, count });
    } catch (err) {
      logger.error("Notifications", "Failed to fetch unread count", err as Error);
      return res.status(500).json({ success: false, message: "Failed to fetch count" });
    }
  });

  // POST /api/notifications/:id/read
  app.post("/api/notifications/:id/read", loadUser, requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const id = Number(req.params.id);
      if (!id || isNaN(id)) {
        return res.status(400).json({ success: false, message: "Invalid notification id" });
      }

      const [updated] = await db
        .update(userNotifications)
        .set({ isRead: true, readAt: new Date() })
        .where(and(eq(userNotifications.id, id), eq(userNotifications.userId, userId)))
        .returning({ id: userNotifications.id });

      if (!updated) {
        return res.status(404).json({ success: false, message: "Notification not found" });
      }

      return res.json({ success: true });
    } catch (err) {
      logger.error("Notifications", "Failed to mark notification read", err as Error);
      return res.status(500).json({ success: false, message: "Failed to mark read" });
    }
  });

  // POST /api/notifications/read-all
  app.post("/api/notifications/read-all", loadUser, requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      await db
        .update(userNotifications)
        .set({ isRead: true, readAt: new Date() })
        .where(and(eq(userNotifications.userId, userId), eq(userNotifications.isRead, false)));

      return res.json({ success: true });
    } catch (err) {
      logger.error("Notifications", "Failed to mark all read", err as Error);
      return res.status(500).json({ success: false, message: "Failed to mark all read" });
    }
  });

  // POST /api/notifications/device-token
  // Register or update an FCM push token from the mobile app.
  // Called by Flutter on login and whenever the FCM token refreshes.
  const registerTokenSchema = z.object({
    token: z.string().min(10, "Invalid FCM token"),
    platform: z.enum(["android", "ios", "web"]),
    deviceId: z.string().optional(),
    deviceName: z.string().optional(),
  });

  app.post("/api/notifications/device-token", loadUser, requireAuth, async (req: Request, res: Response) => {
    try {
      const parsed = registerTokenSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, message: "Invalid request", errors: parsed.error.flatten() });
      }

      const userId = req.user!.id;
      const { token, platform, deviceId, deviceName } = parsed.data;
      const effectiveDeviceId = deviceId ?? `anon-${userId}-${Date.now()}`;

      const [existing] = await db
        .select({ id: registeredDevices.id })
        .from(registeredDevices)
        .where(and(eq(registeredDevices.userId, userId), eq(registeredDevices.deviceId, effectiveDeviceId)))
        .limit(1);

      if (existing) {
        await db
          .update(registeredDevices)
          .set({ pushToken: token, platform, isActive: true, lastSeenAt: new Date() })
          .where(eq(registeredDevices.id, existing.id));
      } else {
        await db.insert(registeredDevices).values({
          userId,
          pushToken: token,
          platform,
          deviceId: effectiveDeviceId,
          deviceName: deviceName ?? null,
          isActive: true,
        });
      }

      return res.json({ success: true });
    } catch (err) {
      logger.error("Notifications", "Failed to register device token", err as Error);
      return res.status(500).json({ success: false, message: "Failed to register device token" });
    }
  });

  logger.info("Notifications", "Notification routes registered");
}
