import type { Request, Response } from "express";
import { logger } from "../../observability";
import { getBusinessMarketingReport, getMarketingFrequencyStatus, NotFoundError } from "./service";

function badRequest(res: Response, msg: string) {
  return res.status(400).json({ success: false, error: msg });
}
function parseId(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function getReport(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  if (businessId === null) return badRequest(res, "Invalid businessId");

  try {
    const report = await getBusinessMarketingReport(businessId);
    return res.json({ success: true, report });
  } catch (error) {
    logger.error("Marketing", "Failed to compute business marketing report", error as Error);
    return res.status(500).json({ success: false, error: "Failed to compute business marketing report" });
  }
}

export async function getFrequency(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  if (businessId === null) return badRequest(res, "Invalid businessId");

  const customerId = req.query.customerId !== undefined ? parseId(req.query.customerId) : undefined;
  if (req.query.customerId !== undefined && customerId === null) return badRequest(res, "Invalid customerId");

  try {
    const status = await getMarketingFrequencyStatus(businessId, customerId ?? undefined);
    return res.json({ success: true, frequency: status });
  } catch (error) {
    if (error instanceof NotFoundError) return res.status(404).json({ success: false, error: error.message });
    logger.error("Marketing", "Failed to compute frequency status", error as Error);
    return res.status(500).json({ success: false, error: "Failed to compute frequency status" });
  }
}
