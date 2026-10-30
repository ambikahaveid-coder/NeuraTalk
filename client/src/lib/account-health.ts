/** Business messaging account health (server/modules/messaging/account-health.ts). */
export interface AccountHealth {
  quality: "new" | "high" | "medium" | "low";
  tier: number;
  effectiveLimit: number;
  pinned: boolean;
  usedLast24h: number;
  reachedLast7d: number;
  negative: { blocks: number; optOuts: number; reports: number };
  negativeRatePercent: number;
  nextTier: number | null;
  advice: string;
  restriction?: { reason: string; since: string } | null;
  notices?: PolicyNotice[];
  prices?: { marketingPaise: number; utilityPaise: number; otpPaise: number };
}

export interface PolicyNotice {
  id: number;
  action: "warning" | "restricted" | "lifted";
  reason: string;
  reportId: number | null;
  createdAt: string;
}

export const NOTICE_LABEL: Record<PolicyNotice["action"], string> = {
  warning: "Warning",
  restricted: "Campaigns paused",
  lifted: "Campaigns resumed",
};

/** "₹0.10" from paise. */
export function rupees(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}

export const QUALITY_LABEL: Record<AccountHealth["quality"], { text: string; className: string }> = {
  new: { text: "New", className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200" },
  high: { text: "High", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" },
  medium: { text: "Medium", className: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
  low: { text: "Low", className: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200" },
};
