/**
 * NeuraTalk policy actions on a business: a warning, a restriction (no
 * campaigns until lifted) or lifting it -- each with the reason, who did it
 * and (optionally) the abuse report it came from. The business sees them in
 * its Account health card; the super admin sees the history per company.
 * Table `business_policy_actions` is created at startup (additive).
 */
import { db } from "../../db";
import { sql } from "drizzle-orm";

export type PolicyActionType = "warning" | "restricted" | "lifted";

export interface PolicyAction {
  id: number;
  action: PolicyActionType;
  reason: string;
  reportId: number | null;
  createdAt: string;
}

export async function ensurePolicyTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "business_policy_actions" (
      "id" serial PRIMARY KEY,
      "business_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "action" text NOT NULL,
      "reason" text NOT NULL,
      "report_id" integer,
      "created_by" integer,
      "created_at" timestamp DEFAULT now()
    )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "business_policy_actions_business_idx" ON "business_policy_actions" ("business_id", "created_at")`);
}

function rows(result: unknown): Record<string, unknown>[] {
  return ((result as { rows?: Record<string, unknown>[] }).rows ?? (result as Record<string, unknown>[])) || [];
}

export async function listPolicyActions(businessId: number, limit = 20): Promise<PolicyAction[]> {
  try {
    const result = await db.execute(sql`
      SELECT id, action, reason, report_id, created_at FROM business_policy_actions
      WHERE business_id = ${businessId} ORDER BY created_at DESC, id DESC LIMIT ${limit}`);
    return rows(result).map((r) => ({
      id: Number(r.id),
      action: r.action as PolicyActionType,
      reason: String(r.reason),
      reportId: r.report_id == null ? null : Number(r.report_id),
      createdAt: new Date(r.created_at as string).toISOString(),
    }));
  } catch {
    return [];
  }
}

/** Restricted when the latest restrict/lift action is a restriction. */
export function isRestricted(actions: PolicyAction[]): PolicyAction | null {
  const latest = actions.find((a) => a.action === "restricted" || a.action === "lifted");
  return latest?.action === "restricted" ? latest : null;
}

export async function addPolicyAction(businessId: number, action: PolicyActionType, reason: string, adminUserId: number, reportId?: number | null): Promise<PolicyAction> {
  await ensurePolicyTable();
  const [row] = rows(await db.execute(sql`
    INSERT INTO business_policy_actions (business_id, action, reason, report_id, created_by)
    VALUES (${businessId}, ${action}, ${reason}, ${reportId ?? null}, ${adminUserId})
    RETURNING id, action, reason, report_id, created_at`));
  return {
    id: Number(row.id),
    action: row.action as PolicyActionType,
    reason: String(row.reason),
    reportId: row.report_id == null ? null : Number(row.report_id),
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}
