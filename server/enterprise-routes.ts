import type { Express, Request, Response } from "express";
import { db } from "./db";
import { users, bridgedCalls, auditLogs, callTranslations } from "@shared/schema";
import { desc, sql, count, eq, and, or, isNull } from "drizzle-orm";
import { loadUser, requireCompanyAdminOrAbove } from "./role-middleware";
import {
  endCallById as endUnifiedCallById,
  getSmartCall,
  initiateCall as initiateUnifiedCall,
} from "./modules/calls/service";

export function registerEnterpriseRoutes(app: Express): void {
  
  app.get("/api/enterprise/analytics", loadUser, requireCompanyAdminOrAbove, async (req: Request, res: Response) => {
    try {
      const range = req.query.range as string || "7d";
      const user = req.user!;
      const orgId = user.organizationId;
      const isSuperAdmin = user.role === "super_admin";

      let userCountCondition = eq(users.isActive, true);
      if (!isSuperAdmin && orgId) {
        userCountCondition = and(eq(users.isActive, true), eq(users.organizationId, orgId))!;
      }

      const [userStats] = await db.select({
        activeUsers: count(users.id),
      }).from(users).where(userCountCondition);

      const [translationStats] = await db.select({
        translationMinutes: sql<number>`COALESCE(COUNT(*) * 2, 0)`,
      }).from(callTranslations);

      const [callStats] = await db.select({
        totalCalls: count(bridgedCalls.id),
        totalMinutes: sql<number>`COALESCE(SUM(${bridgedCalls.duration}) / 60, 0)`,
        avgDuration: sql<number>`COALESCE(AVG(${bridgedCalls.duration}) / 60, 0)`,
      }).from(bridgedCalls);

      const [todayCalls] = await db.select({
        count: count(bridgedCalls.id),
      }).from(bridgedCalls).where(
        sql`${bridgedCalls.createdAt} >= CURRENT_DATE`
      );

      const languageRows = await db.execute(sql`
        SELECT lang, COUNT(*) as calls FROM (
          SELECT ${bridgedCalls.callerLanguage} as lang FROM ${bridgedCalls} WHERE ${bridgedCalls.callerLanguage} IS NOT NULL
          UNION ALL
          SELECT ${bridgedCalls.receiverLanguage} as lang FROM ${bridgedCalls} WHERE ${bridgedCalls.receiverLanguage} IS NOT NULL
        ) sub GROUP BY lang ORDER BY calls DESC LIMIT 5
      `);
      const totalLangCalls = (languageRows as any).rows.reduce((sum: number, r: any) => sum + Number(r.calls), 0) || 1;
      const topLanguages = (languageRows as any).rows.length > 0
        ? (languageRows as any).rows.map((r: any) => ({
            language: r.lang || "Unknown",
            calls: Number(r.calls),
            percentage: Math.round((Number(r.calls) / totalLangCalls) * 100),
          }))
        : [{ language: "English", calls: 0, percentage: 100 }];

      const dayRows = await db.execute(sql`
        SELECT TO_CHAR(${bridgedCalls.createdAt}, 'Dy') as day, COUNT(*) as calls
        FROM ${bridgedCalls}
        WHERE ${bridgedCalls.createdAt} >= NOW() - INTERVAL '7 days'
        GROUP BY TO_CHAR(${bridgedCalls.createdAt}, 'Dy'), EXTRACT(DOW FROM ${bridgedCalls.createdAt})
        ORDER BY EXTRACT(DOW FROM ${bridgedCalls.createdAt})
      `);
      const callsByDay = (dayRows as any).rows.length > 0
        ? (dayRows as any).rows.map((r: any) => ({ day: r.day, calls: Number(r.calls) }))
        : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => ({ day: d, calls: 0 }));

      res.json({
        totalCalls: callStats?.totalCalls || 0,
        totalMinutes: Math.round(callStats?.totalMinutes || 0),
        translationMinutes: translationStats?.translationMinutes || 0,
        activeUsers: userStats?.activeUsers || 0,
        callsToday: todayCalls?.count || 0,
        avgCallDuration: Number(Number(callStats?.avgDuration || 0).toFixed(1)),
        topLanguages,
        callsByDay,
        // Real emotion data from call_translations table
        emotionBreakdown: await (async () => {
          try {
            const emotionRows = await db.execute(sql`
              SELECT emotion_detected as emotion, COUNT(*) as cnt FROM call_translations 
              WHERE emotion_detected IS NOT NULL AND emotion_detected != ''
              GROUP BY emotion_detected ORDER BY cnt DESC LIMIT 5
            `);
            const rows = (emotionRows as any).rows;
            if (rows.length > 0) {
              const total = rows.reduce((s: number, r: any) => s + Number(r.cnt), 0);
              return rows.map((r: any) => ({
                emotion: r.emotion.charAt(0).toUpperCase() + r.emotion.slice(1),
                percentage: Math.round((Number(r.cnt) / total) * 100),
              }));
            }
            return [{ emotion: "No data yet", percentage: 100 }];
          } catch { return [{ emotion: "No data yet", percentage: 100 }]; }
        })(),
      });
    } catch (error) {
      console.error("Enterprise analytics error:", error);
      res.status(500).json({ error: "Failed to fetch analytics" });
    }
  });

  app.get("/api/enterprise/team", loadUser, requireCompanyAdminOrAbove, async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const orgId = user.organizationId;
      const isSuperAdmin = user.role === "super_admin";

      let queryCondition = undefined;
      if (!isSuperAdmin && orgId) {
        queryCondition = eq(users.organizationId, orgId);
      }

      const teamMembers = await db.select({
        id: users.id,
        name: users.username,
        email: users.email,
        role: users.role,
        isActive: users.isActive,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
        organizationId: users.organizationId,
      }).from(users).where(queryCondition).limit(50);

      const callCountRows = await db.execute(sql`
        SELECT caller_user_id as uid, COUNT(*) as calls FROM bridged_calls
        WHERE caller_user_id IS NOT NULL
        GROUP BY caller_user_id
      `);
      const callCountMap = new Map<number, number>();
      (callCountRows as any).rows.forEach((r: any) => callCountMap.set(Number(r.uid), Number(r.calls)));

      const formattedMembers = teamMembers.map((member) => ({
        id: member.id,
        name: member.name || `User ${member.id}`,
        email: member.email || `user${member.id}@company.com`,
        role: member.role === "super_admin" ? "admin" : member.role === "company_admin" ? "manager" : "agent",
        department: member.role === "super_admin" ? "Management" : member.role === "company_admin" ? "Operations" : "Support",
        status: member.isActive ? "active" : "inactive",
        lastActive: member.lastLoginAt 
          ? getRelativeTime(member.lastLoginAt)
          : "Never",
        calls: callCountMap.get(member.id) || 0,
      }));

      const adminCount = teamMembers.filter(m => m.role === "super_admin" || m.role === "company_admin").length;
      const activeCount = teamMembers.filter(m => m.isActive).length;

      res.json({
        members: formattedMembers,
        stats: {
          total: teamMembers.length,
          active: activeCount,
          admins: adminCount,
          managers: teamMembers.filter(m => m.role === "company_admin").length,
          agents: teamMembers.filter(m => m.role === "agent" || m.role === "consumer").length,
        },
      });
    } catch (error) {
      console.error("Enterprise team error:", error);
      res.status(500).json({ error: "Failed to fetch team" });
    }
  });

  app.get("/api/enterprise/audit-logs", loadUser, requireCompanyAdminOrAbove, async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const orgId = user.organizationId;
      const isSuperAdmin = user.role === "super_admin";

      let logsQuery = db.select({
        id: auditLogs.id,
        organizationId: auditLogs.organizationId,
        userId: auditLogs.userId,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        ipAddress: auditLogs.ipAddress,
        createdAt: auditLogs.createdAt,
      }).from(auditLogs);

      if (!isSuperAdmin && orgId) {
        logsQuery = logsQuery.where(eq(auditLogs.organizationId, orgId)) as typeof logsQuery;
      }

      const logs = await logsQuery
        .orderBy(desc(auditLogs.createdAt))
        .limit(50);

      let orgUserIds: number[] = [];
      if (!isSuperAdmin && orgId) {
        const orgUsers = await db.select({ id: users.id }).from(users).where(eq(users.organizationId, orgId));
        orgUserIds = orgUsers.map(u => u.id);
      }

      const usersMap = new Map<number, string>();
      const usersList = await db.select({
        id: users.id,
        username: users.username,
      }).from(users);
      usersList.forEach(u => usersMap.set(u.id, u.username));

      const filteredLogs = !isSuperAdmin && orgId
        ? logs.filter((log) => log.organizationId === orgId || (log.userId !== null && orgUserIds.includes(log.userId)))
        : logs;

      const formattedLogs = filteredLogs.map((log) => ({
        id: log.id,
        user: log.userId ? usersMap.get(log.userId) || "Unknown" : "System",
        action: log.action,
        resource: `${log.entityType || "System"} ${log.entityId || ""}`.trim(),
        ip: log.ipAddress || "System",
        timestamp: log.createdAt ? getRelativeTime(log.createdAt) : "Unknown",
        status: "success",
      }));

      res.json({ logs: formattedLogs });
    } catch (error) {
      console.error("Enterprise audit logs error:", error);
      res.status(500).json({ error: "Failed to fetch audit logs" });
    }
  });

  app.get("/api/enterprise/recordings", loadUser, requireCompanyAdminOrAbove, async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const orgId = user.organizationId;
      const isSuperAdmin = user.role === "super_admin";

      let orgUserIds: number[] = [];
      if (!isSuperAdmin && orgId) {
        const orgUsers = await db.select({ id: users.id }).from(users).where(eq(users.organizationId, orgId));
        orgUserIds = orgUsers.map(u => u.id);
      }

      const calls = await db.select({
        id: bridgedCalls.id,
        callSid: bridgedCalls.callSid,
        callerNumber: bridgedCalls.callerNumber,
        receiverNumber: bridgedCalls.receiverNumber,
        callerUserId: bridgedCalls.callerUserId,
        receiverUserId: bridgedCalls.receiverUserId,
        callerLanguage: bridgedCalls.callerLanguage,
        receiverLanguage: bridgedCalls.receiverLanguage,
        duration: bridgedCalls.duration,
        createdAt: bridgedCalls.createdAt,
      }).from(bridgedCalls).orderBy(desc(bridgedCalls.createdAt)).limit(50);

      let filteredCalls = calls;
      if (!isSuperAdmin && orgId) {
        filteredCalls = calls.filter(call => 
          (call.callerUserId && orgUserIds.includes(call.callerUserId)) ||
          (call.receiverUserId && orgUserIds.includes(call.receiverUserId))
        );
      }

      const recordings = filteredCalls.slice(0, 20).map((call) => ({
        id: call.id,
        callId: call.callSid || `CALL-${call.id}`,
        caller: call.callerNumber || "Unknown Caller",
        receiver: call.receiverNumber || "Unknown Receiver",
        duration: call.duration ? formatDuration(call.duration) : "0:00",
        language: `${call.callerLanguage || "en"} → ${call.receiverLanguage || "en"}`,
        timestamp: call.createdAt ? getRelativeTime(call.createdAt) : "Unknown",
        hasConsent: true,
      }));

      const thisMonthCalls = filteredCalls.filter(c => {
        if (!c.createdAt) return false;
        const now = new Date();
        return c.createdAt.getMonth() === now.getMonth() && c.createdAt.getFullYear() === now.getFullYear();
      });

      res.json({
        recordings,
        stats: {
          total: filteredCalls.length,
          thisMonth: thisMonthCalls.length,
          storage: `${(filteredCalls.length * 0.15).toFixed(1)} GB`,
        },
      });
    } catch (error) {
      console.error("Enterprise recordings error:", error);
      res.status(500).json({ error: "Failed to fetch recordings" });
    }
  });
}

function getRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins} min ago`;
  
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} hr ago`;
  
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  
  return date.toLocaleDateString();
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

interface ActiveEnterpriseCall {
  callId: string;
  tenantId: number | null;
  agentId: number;
  destination: string;
  status: 'dialing' | 'ringing' | 'active' | 'ended';
  startTime: Date;
  endTime?: Date;
  sourceLanguage: string;
  targetLanguage: string;
  translationEnabled: boolean;
  emotionDetectionEnabled: boolean;
}

const activeEnterpriseCalls = new Map<string, ActiveEnterpriseCall>();

export function registerEnterpriseCallControlRoutes(app: Express): void {

  app.post("/api/enterprise/calls/initiate", loadUser, requireCompanyAdminOrAbove, async (req: Request, res: Response) => {
    try {
      const { destination, sourceLanguage, targetLanguage, enableEmotionDetection } = req.body;
      const user = req.user!;

      if (!destination || !sourceLanguage || !targetLanguage) {
        res.status(400).json({ error: "Missing required fields: destination, sourceLanguage, targetLanguage" });
        return;
      }

      const result = await initiateUnifiedCall({
        callerId: String(user.id),
        callerUsername: user.username,
        callerNumber: (user as any).phone || "",
        calleeIdentifier: destination,
        callerLanguage: sourceLanguage,
        calleeLanguage: targetLanguage,
        callType: "voice",
        enableLipsync: false,
        enableRecording: false,
      });

      const call: ActiveEnterpriseCall = {
        callId: result.callId,
        tenantId: user.organizationId,
        agentId: user.id,
        destination,
        status: 'ringing',
        startTime: new Date(),
        sourceLanguage,
        targetLanguage,
        translationEnabled: true,
        emotionDetectionEnabled: enableEmotionDetection ?? true,
      };

      activeEnterpriseCalls.set(result.callId, call);
      res.json({
        callId: result.callId,
        status: call.status,
        joinMethod: result.joinMethod,
        livekitUrl: result.livekitUrl,
        pstnCallId: result.pstnCallId,
        estimatedRateInrPerMin: result.estimatedRateInrPerMin,
        message: result.joinMethod === "app_to_pstn" ? "Call placed via MSG91 + LiveKit SIP" : "Call initiated via LiveKit",
      });
    } catch (error) {
      console.error("Failed to initiate enterprise call:", error);
      res.status(500).json({ error: "Failed to initiate call" });
    }
  });

  app.get("/api/enterprise/calls/:id/status", loadUser, async (req: Request, res: Response) => {
    try {
      const [call, smartCall] = await Promise.all([
        Promise.resolve(activeEnterpriseCalls.get(req.params.id)),
        getSmartCall(req.params.id),
      ]);
      
      if (!call && !smartCall) {
        res.status(404).json({ error: "Call not found" });
        return;
      }

      const effectiveStart = smartCall?.connectedAt
        ? new Date(smartCall.connectedAt)
        : call?.startTime;
      const effectiveStatus = smartCall?.status
        ? (
          smartCall.status === "active"
            ? "active"
            : smartCall.status === "ended" || smartCall.status === "failed" || smartCall.status === "busy" || smartCall.status === "missed" || smartCall.status === "cancelled"
              ? "ended"
              : "ringing"
        )
        : call?.status || "ended";
      const duration = effectiveStatus === 'active' || effectiveStatus === 'ended'
        ? Math.floor((Date.now() - (effectiveStart?.getTime() || Date.now())) / 1000)
        : 0;

      res.json({
        callId: smartCall?.callId || call!.callId,
        status: effectiveStatus,
        destination: smartCall?.calleeIdentifier || call!.destination,
        duration,
        sourceLanguage: smartCall?.callerLanguage || call!.sourceLanguage,
        targetLanguage: smartCall?.calleeLanguage || call!.targetLanguage,
        translationEnabled: call?.translationEnabled ?? true,
        emotionDetectionEnabled: call?.emotionDetectionEnabled ?? true,
      });
    } catch (error) {
      console.error("Failed to get call status:", error);
      res.status(500).json({ error: "Failed to get call status" });
    }
  });

  app.post("/api/enterprise/calls/:id/end", loadUser, async (req: Request, res: Response) => {
    try {
      const call = activeEnterpriseCalls.get(req.params.id);

      const smartCall = await getSmartCall(req.params.id);

      if (!call && !smartCall) {
        res.status(404).json({ error: "Call not found" });
        return;
      }

      if (call) {
        call.status = 'ended';
        call.endTime = new Date();
      }

      const result = await endUnifiedCallById(req.params.id, "ended");
      const duration = call?.endTime
        ? Math.floor((call.endTime.getTime() - call.startTime.getTime()) / 1000)
        : Math.max(0, Math.round((result.translationMinutes + result.relayOnlyMinutes) * 60));

      res.json({ callId: req.params.id, status: 'ended', duration, message: 'Call ended successfully' });

      setTimeout(() => activeEnterpriseCalls.delete(req.params.id), 60000);
    } catch (error) {
      console.error("Failed to end call:", error);
      res.status(500).json({ error: "Failed to end call" });
    }
  });

  app.post("/api/enterprise/calls/:id/translation/enable", loadUser, async (req: Request, res: Response) => {
    try {
      const call = activeEnterpriseCalls.get(req.params.id);
      if (!call) { res.status(404).json({ error: "Call not found" }); return; }
      call.translationEnabled = true;
      res.json({ callId: call.callId, translationEnabled: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to enable translation" });
    }
  });

  app.post("/api/enterprise/calls/:id/translation/disable", loadUser, async (req: Request, res: Response) => {
    try {
      const call = activeEnterpriseCalls.get(req.params.id);
      if (!call) { res.status(404).json({ error: "Call not found" }); return; }
      call.translationEnabled = false;
      res.json({ callId: call.callId, translationEnabled: false });
    } catch (error) {
      res.status(500).json({ error: "Failed to disable translation" });
    }
  });

  app.patch("/api/enterprise/calls/:id/translation/config", loadUser, async (req: Request, res: Response) => {
    try {
      const call = activeEnterpriseCalls.get(req.params.id);
      if (!call) { res.status(404).json({ error: "Call not found" }); return; }
      
      const { source, target } = req.body;
      if (source) call.sourceLanguage = source;
      if (target) call.targetLanguage = target;

      res.json({ callId: call.callId, sourceLanguage: call.sourceLanguage, targetLanguage: call.targetLanguage });
    } catch (error) {
      res.status(500).json({ error: "Failed to update translation config" });
    }
  });

  app.get("/api/enterprise/usage", loadUser, requireCompanyAdminOrAbove, async (req: Request, res: Response) => {
    try {
      const period = req.query.period as string || "current-month";

      // Real usage from DB
      const [callUsage] = await db.select({
        totalMinutes: sql<number>`COALESCE(SUM(${bridgedCalls.duration}) / 60, 0)`,
        totalCalls: count(bridgedCalls.id),
      }).from(bridgedCalls);

      const [translationUsage] = await db.select({
        translatedMinutes: sql<number>`COALESCE(COUNT(*) * 2, 0)`,
        emotionMinutes: sql<number>`COALESCE(COUNT(CASE WHEN emotion_detected IS NOT NULL AND emotion_detected != '' THEN 1 END) * 2, 0)`,
      }).from(callTranslations);

      const langRows = await db.execute(sql`
        SELECT CONCAT(caller_language, '-', receiver_language) as pair, COUNT(*) as cnt
        FROM bridged_calls
        WHERE caller_language IS NOT NULL AND receiver_language IS NOT NULL
        GROUP BY pair ORDER BY cnt DESC LIMIT 10
      `);
      const languages: Record<string, number> = {};
      (langRows as any).rows.forEach((r: any) => {
        languages[r.pair] = Number(r.cnt);
      });

      const totalMin = Math.round(callUsage?.totalMinutes || 0);
      // Cost estimate: ₹4.2/min for translation (industry average)
      const estimatedCost = Math.round(totalMin * 4.2);

      res.json({
        period,
        totalMinutes: totalMin,
        translatedMinutes: translationUsage?.translatedMinutes || 0,
        languages,
        emotionDetectionMinutes: translationUsage?.emotionMinutes || 0,
        estimatedCost: estimatedCost.toLocaleString('en-IN'),
        currency: "INR",
      });
    } catch (error) {
      console.error("Enterprise usage error:", error);
      res.status(500).json({ error: "Failed to fetch usage" });
    }
  });

  app.get("/api/enterprise/languages", async (req: Request, res: Response) => {
    try {
      // Fetch from DB seed data (supportedLanguages table)
      const langRows = await db.execute(sql`SELECT code, name FROM supported_languages ORDER BY name`);
      const langs = (langRows as any).rows;
      if (langs.length > 0) {
        const azureAvail = !!process.env.AZURE_SPEECH_KEY;
        const elevenAvail = !!(process.env.ELEVEN_LABS_API_KEY || process.env.ELEVENLABS_API_KEY);
        return res.json(langs.map((l: any) => ({
          code: l.code,
          name: l.name,
          stt: azureAvail || elevenAvail,
          tts: azureAvail || elevenAvail,
          emotion: true, // rule-based works for all
        })));
      }
    } catch { /* fallback below */ }
    // Static fallback if DB empty
    res.json([
      { code: "en", name: "English", stt: true, tts: true, emotion: true },
      { code: "te", name: "Telugu", stt: true, tts: true, emotion: true },
      { code: "hi", name: "Hindi", stt: true, tts: true, emotion: true },
      { code: "ta", name: "Tamil", stt: true, tts: true, emotion: true },
      { code: "es", name: "Spanish", stt: true, tts: true, emotion: true },
      { code: "fr", name: "French", stt: true, tts: true, emotion: true },
    ]);
  });
}
