import { type Express, type Request, type Response } from "express";
import { initiateSimCall, endSimCall, getSimCallStatus } from "./twilio-sim-bridge";

// Parse Twilio error codes into user-friendly messages
function parseTwilioError(error: any): { message: string; code: string; isTrialLimit: boolean } {
  const msg = error.message || String(error);
  const code = error.code || error.status || 0;

  // Trial account: unverified 'to' number
  if (code === 21219 || code === 21608 || msg.includes("unverified") || msg.includes("not verified") || msg.includes("trial")) {
    const phoneMatch = msg.match(/\+\d+/);
    const phone = phoneMatch ? phoneMatch[0] : "this number";
    return {
      message: `The number ${phone} is unverified. Trial accounts may only make calls to verified numbers.`,
      code: "TRIAL_UNVERIFIED",
      isTrialLimit: true,
    };
  }

  // Invalid phone number format
  if (code === 21211 || code === 21214 || msg.includes("invalid") && msg.includes("number")) {
    return {
      message: "Invalid phone number. Please include country code (e.g., +91 for India).",
      code: "INVALID_NUMBER",
      isTrialLimit: false,
    };
  }

  // Insufficient funds
  if (code === 20003 || msg.includes("insufficient")) {
    return {
      message: "Insufficient Twilio balance. Please top up your account.",
      code: "NO_FUNDS",
      isTrialLimit: false,
    };
  }

  // Geographic permission
  if (code === 21215 || msg.includes("geographic") || msg.includes("permission")) {
    return {
      message: "Calls to this country are not enabled. Enable it in Twilio console → Voice Geographic Permissions.",
      code: "GEO_PERMISSION",
      isTrialLimit: false,
    };
  }

  return { message: msg, code: "UNKNOWN", isTrialLimit: false };
}

export function registerSimCallRoutes(app: Express) {
  app.post("/api/sim-calls/initiate", async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const {
        phoneNumber,
        callerLanguage,
        receiverLanguage,
        translationEnabled = true,
        emotionPreservation = true,
        voiceProfileId,
      } = req.body;

      if (!phoneNumber || !callerLanguage || !receiverLanguage) {
        return res.status(400).json({ error: "Phone number and languages are required" });
      }

      const callerIdentifier = req.user?.phone || req.user?.email || `user_${userId}`;

      const result = await initiateSimCall({
        phoneNumber,
        callerUserId: userId,
        callerLanguage,
        receiverLanguage,
        translationEnabled,
        emotionPreservation,
        callerIdentifier,
        voiceProfileId,
      });

      res.json({
        success: true,
        callId: result.callId,
        wsToken: result.wsToken,
        wsUrl: `/ws/sim-call/${result.wsToken}`,
        message: "Call initiated. Connect via WebSocket for audio.",
      });
    } catch (error: any) {
      console.error("[SimCall] Initiate error:", error);
      const parsed = parseTwilioError(error);
      const statusCode = parsed.isTrialLimit ? 403 : 500;
      res.status(statusCode).json({
        error: parsed.message,
        code: parsed.code,
        isTrialLimit: parsed.isTrialLimit,
      });
    }
  });

  app.post("/api/sim-calls/:wsToken/end", async (req: Request, res: Response) => {
    try {
      const { wsToken } = req.params;
      await endSimCall(wsToken);
      res.json({ success: true, message: "Call ended" });
    } catch (error: any) {
      console.error("[SimCall] End error:", error);
      res.status(500).json({ error: "Failed to end call" });
    }
  });

  app.get("/api/sim-calls/:wsToken/status", async (req: Request, res: Response) => {
    try {
      const { wsToken } = req.params;
      const status = getSimCallStatus(wsToken);
      if (!status) {
        return res.status(404).json({ error: "Call not found" });
      }
      res.json({
        callId: status.callId,
        status: status.status,
        callerLanguage: status.callerLanguage,
        receiverLanguage: status.receiverLanguage,
        translationEnabled: status.translationEnabled,
      });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to get call status" });
    }
  });

  app.post("/api/sim-calls/status/:wsToken", (req: Request, res: Response) => {
    const { wsToken } = req.params;
    const { CallStatus, CallSid } = req.body;
    console.log(`[SimCall] Twilio status callback: ${CallStatus} for ${wsToken} (SID: ${CallSid})`);

    if (CallStatus === "completed" || CallStatus === "busy" || CallStatus === "no-answer" || CallStatus === "failed" || CallStatus === "canceled") {
      endSimCall(wsToken).catch(console.error);
    }

    res.sendStatus(200);
  });

  // === VERIFIED NUMBER MANAGEMENT ===
  // Twilio trial accounts can only call verified numbers.
  // These endpoints let users verify numbers via Twilio's API.

  // Check if account is trial
  app.get("/api/sim-calls/account-status", async (req: Request, res: Response) => {
    try {
      if (!req.user?.id) return res.status(401).json({ error: "Login required" });

      const sid = process.env.TWILIO_ACCOUNT_SID;
      const token = process.env.TWILIO_AUTH_TOKEN;
      if (!sid || !token) {
        return res.json({ configured: false, isTrial: true, message: "Twilio not configured" });
      }

      // Check account type via Twilio API
      const Twilio = (await import("twilio")).default;
      const client = Twilio(sid, token);
      const account = await client.api.accounts(sid).fetch();
      const isTrial = account.type === "Trial";

      res.json({
        configured: true,
        isTrial,
        twilioNumber: process.env.TWILIO_PHONE_NUMBER || null,
        message: isTrial
          ? "Trial account: You can only call numbers verified in your Twilio account. Verify numbers below or upgrade to a paid Twilio account to call anyone."
          : "Paid account: You can call any valid phone number worldwide.",
      });
    } catch (error: any) {
      console.error("[SimCall] Account status error:", error);
      res.json({ configured: true, isTrial: true, message: "Could not check account type" });
    }
  });

  // List verified outgoing caller IDs
  app.get("/api/sim-calls/verified-numbers", async (req: Request, res: Response) => {
    try {
      if (!req.user?.id) return res.status(401).json({ error: "Login required" });

      const sid = process.env.TWILIO_ACCOUNT_SID;
      const token = process.env.TWILIO_AUTH_TOKEN;
      if (!sid || !token) {
        return res.json({ numbers: [] });
      }

      const Twilio = (await import("twilio")).default;
      const client = Twilio(sid, token);
      const callerIds = await client.outgoingCallerIds.list({ limit: 50 });

      res.json({
        numbers: callerIds.map(c => ({
          sid: c.sid,
          phoneNumber: c.phoneNumber,
          friendlyName: c.friendlyName,
        })),
        twilioNumber: process.env.TWILIO_PHONE_NUMBER || null,
      });
    } catch (error: any) {
      console.error("[SimCall] List verified numbers error:", error);
      res.status(500).json({ error: "Failed to fetch verified numbers" });
    }
  });

  // Request verification for a new number (sends verification call)
  app.post("/api/sim-calls/verify-number", async (req: Request, res: Response) => {
    try {
      if (!req.user?.id) return res.status(401).json({ error: "Login required" });

      const { phoneNumber, friendlyName } = req.body;
      if (!phoneNumber) return res.status(400).json({ error: "Phone number required" });

      const sid = process.env.TWILIO_ACCOUNT_SID;
      const token = process.env.TWILIO_AUTH_TOKEN;
      if (!sid || !token) {
        return res.status(500).json({ error: "Twilio not configured" });
      }

      const Twilio = (await import("twilio")).default;
      const client = Twilio(sid, token);

      const validation = await client.validationRequests.create({
        phoneNumber,
        friendlyName: friendlyName || `NeuraTalk User ${req.user.username || req.user.id}`,
      });

      res.json({
        success: true,
        callSid: validation.callSid,
        phoneNumber: validation.phoneNumber,
        validationCode: validation.validationCode,
        message: `Twilio is calling ${validation.phoneNumber} now. When you answer, enter code: ${validation.validationCode}`,
      });
    } catch (error: any) {
      console.error("[SimCall] Verify number error:", error.code, error.message);
      const msg = error.message || "";
      // Twilio trial can't make outbound calls to unverified numbers
      if (error.code === 21219 || error.code === 21608 || msg.includes("unverified") || msg.includes("trial") || msg.includes("not supported")) {
        return res.status(400).json({
          error: "Trial account cannot send verification calls automatically. Please verify this number manually in the Twilio console.",
          manualVerifyUrl: "https://console.twilio.com/us1/develop/phone-numbers/manage/verified",
        });
      }
      res.status(400).json({ error: msg || "Verification failed" });
    }
  });
}
