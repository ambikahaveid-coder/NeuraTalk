import type { Request, Response } from "express";
import { listUtilityEvents, getUtilityEvent, getUtilityReport } from "./service";
import { UTILITY_MESSAGE_STATUS } from "@shared/schema";

function badRequest(res: Response, msg: string) {
  return res.status(400).json({ success: false, error: msg });
}
function parseId(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function getEvents(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  if (businessId === null) return badRequest(res, "Invalid businessId");

  const customerId = req.query.customerId !== undefined ? parseId(req.query.customerId) : undefined;
  if (req.query.customerId !== undefined && customerId === null) return badRequest(res, "Invalid customerId");

  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  if (status && !Object.values(UTILITY_MESSAGE_STATUS).includes(status as any)) return badRequest(res, "Invalid status filter");

  const events = await listUtilityEvents(businessId, customerId ?? undefined, status);
  return res.json({ success: true, events });
}

export async function getEventById(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  const eventId = parseId(req.params.eventId);
  if (businessId === null || eventId === null) return badRequest(res, "Invalid id");

  const event = await getUtilityEvent(businessId, eventId);
  if (!event) return res.status(404).json({ success: false, error: "Utility event not found" });
  return res.json({ success: true, event });
}

export async function getReport(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  if (businessId === null) return badRequest(res, "Invalid businessId");
  const report = await getUtilityReport(businessId);
  return res.json({ success: true, report });
}
