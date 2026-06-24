import type { Request, Response } from "express";
import { z } from "zod";
import * as service from "./service";
import type { AuthenticatedUser } from "../../role-middleware";

function user(req: Request): AuthenticatedUser {
  return (req as any).user as AuthenticatedUser;
}

function orgId(req: Request): number {
  const u = user(req);
  const id = (u as any).organizationId as number | null;
  if (!id) throw new Error("No organization");
  return id;
}

function actorId(req: Request): number {
  return user(req).id;
}

function ip(req: Request): string {
  return (req.ip ?? req.socket.remoteAddress ?? "unknown");
}

// ── Overview ──────────────────────────────────────────────────────────────────

export async function getOverview(req: Request, res: Response) {
  try {
    const data = await service.getHubOverview(orgId(req));
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// ── Enterprise Numbers ────────────────────────────────────────────────────────

const registerNumberSchema = z.object({
  phoneNumber: z.string().min(7),
  label: z.string().optional(),
  carrier: z.enum(["airtel", "jio", "vi", "bsnl", "sip", "did", "tollfree", "international", "unknown"]).default("unknown"),
  integrationType: z.enum(["sip_trunk", "call_forwarding", "cloud_pbx", "ivr", "contact_center", "api_based", "webhook_based"]),
  countryCode: z.string().default("IN"),
  forwardingTarget: z.string().optional(),
  webhookUrl: z.string().url().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export async function listNumbers(req: Request, res: Response) {
  try {
    const numbers = await service.listEnterpriseNumbers(orgId(req));
    res.json({ success: true, data: numbers });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function registerNumber(req: Request, res: Response) {
  try {
    const body = registerNumberSchema.parse(req.body);
    const created = await service.registerEnterpriseNumber(
      { ...body, organizationId: orgId(req) },
      actorId(req),
      ip(req),
    );
    res.status(201).json({ success: true, data: created });
  } catch (err: any) {
    const status = err instanceof z.ZodError ? 400 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
}

export async function updateNumber(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const patch = registerNumberSchema.partial().parse(req.body);
    const updated = await service.updateEnterpriseNumber(id, orgId(req), patch, actorId(req));
    if (!updated) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: updated });
  } catch (err: any) {
    const status = err instanceof z.ZodError ? 400 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
}

export async function deleteNumber(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const deleted = await service.deleteEnterpriseNumber(id, orgId(req), actorId(req));
    if (!deleted) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// ── Verification ──────────────────────────────────────────────────────────────

const initiateVerificationSchema = z.object({
  method: z.enum(["otp_sms", "otp_call", "dns_txt", "callback", "manual_review"]).default("otp_sms"),
});

export async function initiateVerification(req: Request, res: Response) {
  try {
    const numberId = Number(req.params.id);
    const { method } = initiateVerificationSchema.parse(req.body);
    const result = await service.initiateVerification(numberId, orgId(req), method, actorId(req));
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(err.message === "Enterprise number not found" ? 404 : 500).json({ success: false, error: err.message });
  }
}

const confirmVerificationSchema = z.object({
  verificationId: z.number(),
  otp: z.string().length(6),
});

export async function confirmVerification(req: Request, res: Response) {
  try {
    const { verificationId, otp } = confirmVerificationSchema.parse(req.body);
    const result = await service.confirmVerification(verificationId, orgId(req), otp, actorId(req));
    res.json({ success: true, data: result });
  } catch (err: any) {
    const status = err instanceof z.ZodError ? 400 : err.message.includes("not found") ? 404 : 422;
    res.status(status).json({ success: false, error: err.message });
  }
}

// ── SIP Integrations ──────────────────────────────────────────────────────────

const sipSchema = z.object({
  label: z.string().min(1),
  sipServer: z.string().min(1),
  sipPort: z.number().int().min(1).max(65535).default(5060),
  sipUsername: z.string().optional(),
  sipPassword: z.string().optional(),
  transport: z.enum(["udp", "tcp", "tls"]).default("udp"),
  codecPreference: z.string().optional(),
  enterpriseNumberId: z.number().optional(),
  isActive: z.boolean().default(true),
});

export async function listSip(req: Request, res: Response) {
  try {
    const data = await service.listSipIntegrations(orgId(req));
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function createSip(req: Request, res: Response) {
  try {
    const body = sipSchema.parse(req.body);
    const created = await service.upsertSipIntegration({ ...body, organizationId: orgId(req) }, actorId(req));
    res.status(201).json({ success: true, data: created });
  } catch (err: any) {
    const status = err instanceof z.ZodError ? 400 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
}

export async function updateSip(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const patch = sipSchema.partial().parse(req.body);
    const updated = await service.updateSipIntegration(id, orgId(req), patch, actorId(req));
    if (!updated) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: updated });
  } catch (err: any) {
    const status = err instanceof z.ZodError ? 400 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
}

export async function deleteSip(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const deleted = await service.deleteSipIntegration(id, orgId(req), actorId(req));
    if (!deleted) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// ── Language Rules ────────────────────────────────────────────────────────────

const languageRuleSchema = z.object({
  enterpriseNumberId: z.number(),
  callerLanguage: z.string().min(2),
  agentLanguage: z.string().min(2),
  autoTranslate: z.boolean().default(true),
  priority: z.number().int().default(0),
  routeToSkill: z.string().optional(),
  isActive: z.boolean().default(true),
});

export async function listLanguageRules(req: Request, res: Response) {
  try {
    const numId = req.query.enterpriseNumberId ? Number(req.query.enterpriseNumberId) : undefined;
    const data = await service.listLanguageRules(orgId(req), numId);
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function createLanguageRule(req: Request, res: Response) {
  try {
    const body = languageRuleSchema.parse(req.body);
    const created = await service.upsertLanguageRule({ ...body, organizationId: orgId(req) }, actorId(req));
    res.status(201).json({ success: true, data: created });
  } catch (err: any) {
    const status = err instanceof z.ZodError ? 400 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
}

export async function deleteLanguageRule(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const deleted = await service.deleteLanguageRule(id, orgId(req), actorId(req));
    if (!deleted) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// ── AI Configurations ─────────────────────────────────────────────────────────

const aiConfigSchema = z.object({
  enterpriseNumberId: z.number(),
  translationEnabled: z.boolean().default(false),
  transcriptionEnabled: z.boolean().default(false),
  sentimentAnalysisEnabled: z.boolean().default(false),
  agentAssistEnabled: z.boolean().default(false),
  qualityMonitoringEnabled: z.boolean().default(false),
  callSummaryEnabled: z.boolean().default(false),
  piiRedactionEnabled: z.boolean().default(false),
  defaultSrcLanguage: z.string().default("auto"),
  defaultTgtLanguage: z.string().default("en-US"),
  customPrompt: z.string().optional(),
});

export async function getAiConfig(req: Request, res: Response) {
  try {
    const numberId = Number(req.params.numberId);
    const data = await service.getAiConfiguration(numberId, orgId(req));
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function upsertAiConfig(req: Request, res: Response) {
  try {
    const body = aiConfigSchema.parse(req.body);
    const data = await service.upsertAiConfiguration({ ...body, organizationId: orgId(req) }, actorId(req));
    res.json({ success: true, data });
  } catch (err: any) {
    const status = err instanceof z.ZodError ? 400 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
}

// ── Audit Logs ────────────────────────────────────────────────────────────────

export async function getAuditLogs(req: Request, res: Response) {
  try {
    const limit = Math.min(Number(req.query.limit ?? 100), 500);
    const data = await service.listIntegrationAuditLogs(orgId(req), limit);
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}
