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
import { registeredDevices } from "@shared/schema";
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
  
  if (!serviceAccountJson) {
    logger.warn(
      "FirebaseAdmin",
      "FIREBASE_SERVICE_ACCOUNT_JSON not set - Firebase Phone Auth will not be available. " +
      "To enable, download service account JSON from Firebase Console and set as secret."
    );
    return false;
  }
  
  try {
    const serviceAccount = JSON.parse(serviceAccountJson);
    
    firebaseAdminApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    
    logger.info("FirebaseAdmin", "Firebase Admin SDK initialized successfully");
    return true;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error("FirebaseAdmin", `Failed to initialize Firebase Admin SDK: ${errorMessage}`);
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
    logger.warn("FirebaseAdmin", "Cannot verify token - Firebase Admin not initialized");
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
