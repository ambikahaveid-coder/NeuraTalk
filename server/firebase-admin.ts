/**
 * Firebase Admin SDK for Server-Side Token Verification
 * 
 * WHY THIS EXISTS:
 * - Firebase Phone Auth tokens must be verified on the server side
 * - Client-side verification is NOT sufficient for security
 * - This ensures attackers cannot bypass OTP by sending fake tokens
 * 
 * SETUP REQUIRED:
 * Set FIREBASE_SERVICE_ACCOUNT_JSON environment variable with the service account JSON
 * Get this from Firebase Console > Project Settings > Service Accounts > Generate New Private Key
 */

import admin from "firebase-admin";
import { and, eq, or } from "drizzle-orm";
import { db } from "./db";
import { registeredDevices, users } from "@shared/schema";
import { logger } from "./observability";

let firebaseAdminApp: admin.app.App | null = null;
let firebaseAdminInitialized = false;

/**
 * Initialize Firebase Admin SDK
 * Called once at server startup
 */
export function initializeFirebaseAdmin(): boolean {
  if (firebaseAdminInitialized) {
    return !!firebaseAdminApp;
  }
  
  firebaseAdminInitialized = true;
  
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const isProduction = process.env.NODE_ENV === "production" || process.env.NODE_ENV === "staging";

  if (!serviceAccountJson) {
    const message =
      "FIREBASE_SERVICE_ACCOUNT_JSON is not set. " +
      "Phone OTP login will be unavailable until this is configured. " +
      "Download the service account JSON from Firebase Console → Project Settings → Service Accounts.";

    // Degrade gracefully — phone OTP won't work but the server stays up
    logger.warn("FirebaseAdmin", message + (isProduction ? " (production: phone auth disabled)" : " (dev: phone auth disabled)"));
    return false;
  }

  try {
    const serviceAccount = JSON.parse(serviceAccountJson);

    if (!serviceAccount.project_id || !serviceAccount.private_key || !serviceAccount.client_email) {
      throw new Error("Service account JSON is missing required fields (project_id, private_key, client_email)");
    }

    firebaseAdminApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    logger.info("FirebaseAdmin", `Firebase Admin SDK initialized for project: ${serviceAccount.project_id}`);
    return true;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error("FirebaseAdmin", `Failed to initialize Firebase Admin SDK: ${errorMessage}`);

    logger.warn("FirebaseAdmin", `Firebase Admin SDK init failed — phone auth disabled: ${errorMessage}`);
    return false;
  }
}

/**
 * Verify a Firebase ID token
 * Returns the decoded token with phone number if valid, null if invalid
 */
export async function verifyFirebaseToken(
  idToken: string
): Promise<{ phoneNumber: string; uid: string } | null> {
  if (!firebaseAdminApp) {
    logger.error("FirebaseAdmin", "Cannot verify Firebase ID token — Firebase Admin SDK is not initialized. Ensure FIREBASE_SERVICE_ACCOUNT_JSON is set.");
    return null;
  }
  
  try {
    const decodedToken = await firebaseAdminApp.auth().verifyIdToken(idToken);
    
    if (!decodedToken.phone_number) {
      logger.warn("FirebaseAdmin", "Token valid but no phone number claim", {
        uid: decodedToken.uid,
      });
      return null;
    }
    
    logger.info("FirebaseAdmin", "Token verified successfully", {
      uid: decodedToken.uid,
      phoneNumber: decodedToken.phone_number.replace(/\d(?=\d{4})/g, "*"),
    });
    
    return {
      phoneNumber: decodedToken.phone_number,
      uid: decodedToken.uid,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error("FirebaseAdmin", `Token verification failed: ${errorMessage}`);
    return null;
  }
}

/**
 * Check if Firebase Admin is properly configured
 */
export function isFirebaseAdminConfigured(): boolean {
  return !!firebaseAdminApp;
}

export async function sendVoIPPush(
  userId: string,
  payload: { callId: string; callerId: string; callType: string; callerName?: string },
): Promise<{ sent: number; failed: number }> {
  if (!firebaseAdminApp) {
    logger.warn("FirebaseAdmin", "Skipping call push - Firebase Admin not initialized", {
      userId,
      callId: payload.callId,
    });
    return { sent: 0, failed: 0 };
  }

  const numericUserId = Number.parseInt(userId, 10);
  if (!Number.isFinite(numericUserId)) {
    logger.warn("FirebaseAdmin", "Skipping call push - invalid user id", { userId });
    return { sent: 0, failed: 0 };
  }

  const devices = await db.select({
    id: registeredDevices.id,
    pushToken: registeredDevices.pushToken,
    voipToken: registeredDevices.voipToken,
    platform: registeredDevices.platform,
    deviceId: registeredDevices.deviceId,
  }).from(registeredDevices).where(and(
    eq(registeredDevices.userId, numericUserId),
    eq(registeredDevices.isActive, true),
    or(
      eq(registeredDevices.platform, "android"),
      eq(registeredDevices.platform, "ios"),
      eq(registeredDevices.platform, "web"),
    ),
  ));

  const tokens = Array.from(
    new Set(
      devices.flatMap((device) => [device.pushToken, device.voipToken]).filter(
        (token): token is string => typeof token === "string" && token.trim().length > 0,
      ),
    ),
  );

  if (tokens.length === 0) {
    logger.info("FirebaseAdmin", "No active device tokens for incoming call push", {
      userId,
      callId: payload.callId,
    });
    return { sent: 0, failed: 0 };
  }

  const response = await firebaseAdminApp.messaging().sendEachForMulticast({
    tokens,
    data: {
      type: "incoming_call",
      callId: payload.callId,
      callerId: payload.callerId,
      callType: payload.callType,
      callerName: payload.callerName || payload.callerId,
    },
    android: {
      priority: "high",
      ttl: 30000,
      notification: {
        title: `📲 Incoming ${payload.callType} call`,
        body: `${payload.callerName || payload.callerId} is calling`,
        sound: "default",
        channelId: "incoming_calls",
      },
    },
    apns: {
      headers: {
        "apns-priority": "10",
        "apns-push-type": "voip",
      },
      payload: {
        aps: {
          sound: "default",
          contentAvailable: true,
          alert: {
            title: `📲 Incoming ${payload.callType} call`,
            body: `${payload.callerName || payload.callerId} is calling`,
          },
        },
      },
    },
    // Web: data-only so Service Worker fully controls notification display
    // (allows Answer/Reject action buttons)
    webpush: {
      headers: { Urgency: "high" },
      data: {
        type: "incoming_call",
        callId: payload.callId,
        callerId: payload.callerId,
        callerName: payload.callerName || payload.callerId,
        callType: payload.callType,
      },
    },
  });

  if (response.failureCount > 0) {
    response.responses.forEach((result, index) => {
      if (!result.success) {
        logger.warn("FirebaseAdmin", "Call push delivery failed", {
          userId,
          callId: payload.callId,
          tokenSuffix: tokens[index]?.slice(-8),
          error: result.error?.message,
        });
      }
    });
  }

  logger.info("FirebaseAdmin", "Incoming call push sent", {
    userId,
    callId: payload.callId,
    sent: response.successCount,
    failed: response.failureCount,
  });

  return {
    sent: response.successCount,
    failed: response.failureCount,
  };
}

/**
 * Send a general push notification to all active devices of a user.
 * Used for missed calls, payment confirmations, subscription alerts, etc.
 */
export async function sendPushNotification(
  userId: number,
  notification: { title: string; body: string; data?: Record<string, string> },
): Promise<{ sent: number; failed: number }> {
  if (!firebaseAdminApp) {
    return { sent: 0, failed: 0 };
  }

  // Message-notification opt-out (Settings > Notifications). Call alerts use
  // sendVoIPPush separately, above, and are never gated by this.
  const [userRow] = await db
    .select({ pushNotificationsEnabled: users.pushNotificationsEnabled })
    .from(users)
    .where(eq(users.id, userId));
  if (userRow && userRow.pushNotificationsEnabled === false) {
    return { sent: 0, failed: 0 };
  }

  const devices = await db
    .select({ pushToken: registeredDevices.pushToken, platform: registeredDevices.platform })
    .from(registeredDevices)
    .where(and(eq(registeredDevices.userId, userId), eq(registeredDevices.isActive, true)));

  const tokens = Array.from(
    new Set(devices.map((d) => d.pushToken).filter((t): t is string => typeof t === "string" && t.length > 0)),
  );

  if (tokens.length === 0) return { sent: 0, failed: 0 };

  const data: Record<string, string> = {};
  if (notification.data) {
    for (const [k, v] of Object.entries(notification.data)) {
      data[k] = String(v);
    }
  }

  const response = await firebaseAdminApp.messaging().sendEachForMulticast({
    tokens,
    notification: { title: notification.title, body: notification.body },
    data,
    android: { priority: "high" },
    apns: { headers: { "apns-priority": "10" } },
  });

  logger.info("FirebaseAdmin", "General push notification sent", {
    userId,
    title: notification.title,
    sent: response.successCount,
    failed: response.failureCount,
  });

  return { sent: response.successCount, failed: response.failureCount };
}
