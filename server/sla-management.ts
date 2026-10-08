import { Request, Response, Router } from "express";
import { db } from "./db";
import { organizations, callTelemetry } from "@shared/schema";
import { eq, gte } from "drizzle-orm";
import { requireRole, requireAuth } from "./role-middleware";
import { translatorHealth } from "./translator-health";

const router = Router();

interface SLAMetrics {
  uptime: number | null;
  avgResponseTime: number | null;
  avgCallQuality: number | null;
  totalCalls: number | null;
  failedCalls: number | null;
  successRate: number | null;
}

interface SystemStatus {
  status: "operational" | "degraded" | "outage";
  services: {
    name: string;
    status: "operational" | "degraded" | "outage";
    latency?: number;
    message?: string;
  }[];
  lastUpdated: Date;
}

const SLA_TARGETS = {
  uptime: 99.9,
  responseTime: 200,
  callQuality: 4.0,
  successRate: 99.5,
};

async function getSystemStatus(): Promise<SystemStatus> {
  const services = [];

  try {
    const dbStart = Date.now();
    await db.select().from(organizations).limit(1);
    const dbLatency = Date.now() - dbStart;
    
    services.push({
      name: "Database",
      status: dbLatency < 100 ? "operational" as const : dbLatency < 500 ? "degraded" as const : "outage" as const,
      latency: dbLatency,
    });
  } catch {
    services.push({
      name: "Database",
      status: "outage" as const,
      message: "Database connection failed",
    });
  }

  // This handler answering is the API check.
  services.push({
    name: "API",
    status: "operational" as const,
  });

  // From real translator-bot starts, not a fixed "operational".
  services.push({
    name: "Call Translation",
    ...translatorHealth(),
  });

  services.push({
    name: "AI Services",
    status: process.env.OPENAI_API_KEY ? "operational" as const : "degraded" as const,
    message: process.env.OPENAI_API_KEY ? undefined : "API key not configured",
  });

  services.push({
    name: "Payment Gateway",
    status: process.env.RAZORPAY_KEY_ID ? "operational" as const : "degraded" as const,
    message: process.env.RAZORPAY_KEY_ID ? undefined : "Online payments not enabled yet",
  });

  // Payments being switched off is a business decision, not a service fault.
  const core = services.filter(s => s.name !== "Payment Gateway");
  const overallStatus = core.some(s => s.status === "outage") 
    ? "outage" 
    : core.some(s => s.status === "degraded") 
      ? "degraded" 
      : "operational";

  return {
    status: overallStatus,
    services,
    lastUpdated: new Date(),
  };
}

export async function getSLAMetrics(organizationId?: number, _days: number = 30): Promise<SLAMetrics> {
  // callTelemetry has no authoritative organization/date dimensions in the
  // current schema. Do not expose a global sample count through an org route.
  if (organizationId) {
    return {
      uptime: null,
      avgResponseTime: null,
      avgCallQuality: null,
      totalCalls: null,
      failedCalls: null,
      successRate: null,
    };
  }

  const telemetryData = await db.select().from(callTelemetry).limit(100);

  return {
    // Call telemetry does not currently contain authoritative uptime,
    // response-time, quality, or failure-state aggregates. Do not fabricate
    // SLA values from sample size or a fixed failure percentage.
    uptime: null,
    avgResponseTime: null,
    avgCallQuality: null,
    totalCalls: telemetryData.length,
    failedCalls: null,
    successRate: null,
  };
}

router.get("/api/status", async (_req: Request, res: Response) => {
  try {
    const status = await getSystemStatus();
    res.json(status);
  } catch (error) {
    console.error("Error getting system status:", error);
    res.status(500).json({ 
      status: "outage",
      message: "Unable to determine system status",
      lastUpdated: new Date()
    });
  }
});

router.get("/api/organization/sla", requireRole("company_admin", "super_admin", "investor"), async (req: Request, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    const days = parseInt(req.query.days as string) || 30;

    const metrics = await getSLAMetrics(organizationId || undefined, days);

    const compliance = {
      uptime: metrics.uptime === null ? null : metrics.uptime >= SLA_TARGETS.uptime,
      responseTime: metrics.avgResponseTime === null ? null : metrics.avgResponseTime <= SLA_TARGETS.responseTime,
      callQuality: metrics.avgCallQuality === null ? null : metrics.avgCallQuality >= SLA_TARGETS.callQuality,
      successRate: metrics.successRate === null ? null : metrics.successRate >= SLA_TARGETS.successRate,
    };

    const overallCompliance = Object.values(compliance).some((value) => value === null)
      ? null
      : Object.values(compliance).every(Boolean);

    res.json({
      metrics,
      targets: SLA_TARGETS,
      compliance,
      overallCompliance,
      note: "NOT_AVAILABLE: authoritative SLA telemetry is not available for this period.",
      period: {
        days,
        startDate: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
        endDate: new Date(),
      }
    });
  } catch (error) {
    console.error("Error fetching SLA metrics:", error);
    res.status(500).json({ error: "Failed to fetch SLA metrics" });
  }
});

router.get("/api/organization/sla/history", requireRole("company_admin", "super_admin", "investor"), async (req: Request, res: Response) => {
  try {
    const months = parseInt(req.query.months as string) || 6;
    const history = [];

    for (let i = 0; i < months; i++) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      
      history.push({
        month: date.toISOString().slice(0, 7),
        uptime: null,
        avgResponseTime: null,
        successRate: null,
        totalCalls: null,
      });
    }

    res.json({
      history: history.reverse(),
      targets: SLA_TARGETS,
      note: "NOT_AVAILABLE: historical SLA telemetry is not available.",
    });
  } catch (error) {
    console.error("Error fetching SLA history:", error);
    res.status(500).json({ error: "Failed to fetch SLA history" });
  }
});

router.get("/api/organization/sla/report", requireRole("company_admin", "super_admin"), async (req: Request, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    const month = req.query.month as string || new Date().toISOString().slice(0, 7);

    const [org] = organizationId 
      ? await db.select().from(organizations).where(eq(organizations.id, organizationId))
      : [];

    const metrics = await getSLAMetrics(organizationId || undefined, 30);

    const report = {
      organization: org?.name || "Platform",
      period: month,
      generatedAt: new Date(),
      metrics,
      targets: SLA_TARGETS,
      compliance: {
        uptime: { target: SLA_TARGETS.uptime, actual: metrics.uptime, met: metrics.uptime === null ? null : metrics.uptime >= SLA_TARGETS.uptime },
        responseTime: { target: SLA_TARGETS.responseTime, actual: metrics.avgResponseTime, met: metrics.avgResponseTime === null ? null : metrics.avgResponseTime <= SLA_TARGETS.responseTime },
        successRate: { target: SLA_TARGETS.successRate, actual: metrics.successRate, met: metrics.successRate === null ? null : metrics.successRate >= SLA_TARGETS.successRate },
      },
      incidents: [],
      notes: "NOT_AVAILABLE: incident and SLA telemetry is not available for this period.",
    };

    res.json(report);
  } catch (error) {
    console.error("Error generating SLA report:", error);
    res.status(500).json({ error: "Failed to generate SLA report" });
  }
});

router.post("/api/admin/sla/targets", requireRole("super_admin"), async (req: Request, res: Response) => {
  try {
    const { uptime, responseTime, callQuality, successRate } = req.body;

    if (uptime !== undefined) SLA_TARGETS.uptime = uptime;
    if (responseTime !== undefined) SLA_TARGETS.responseTime = responseTime;
    if (callQuality !== undefined) SLA_TARGETS.callQuality = callQuality;
    if (successRate !== undefined) SLA_TARGETS.successRate = successRate;

    res.json({
      success: true,
      message: "SLA targets updated",
      targets: SLA_TARGETS,
    });
  } catch (error) {
    console.error("Error updating SLA targets:", error);
    res.status(500).json({ error: "Failed to update SLA targets" });
  }
});

router.get("/api/admin/sla/targets", requireRole("super_admin"), async (_req: Request, res: Response) => {
  res.json(SLA_TARGETS);
});

export default router;
