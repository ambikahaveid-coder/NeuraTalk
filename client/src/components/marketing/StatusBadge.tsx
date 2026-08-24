import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CheckCircle2, Clock, PlayCircle, XCircle, Ban, PauseCircle, HelpCircle } from "lucide-react";

/**
 * Shared status→color mapping -- Phase 8B Marketing Control Center
 * (2026-08-24). The Phase 8B architecture audit (doc 35) found this
 * pattern duplicated as a local switch statement per page (e.g.
 * SuperAdminDashboard.tsx's own statusBadge()) with no shared component.
 * This is the first shared one -- covers every real status value this
 * console renders (campaign, customer, template-version, consent), never
 * an invented state.
 */

const STATUS_STYLES: Record<string, { className: string; icon: React.ComponentType<{ className?: string }>; label?: string }> = {
  // Campaign statuses (CAMPAIGN_STATUS)
  draft: { className: "bg-muted text-muted-foreground border-transparent", icon: Clock },
  scheduled: { className: "bg-blue-500/15 text-blue-500 border-blue-500/30", icon: Clock },
  running: { className: "bg-amber-500/15 text-amber-500 border-amber-500/30", icon: PlayCircle },
  completed: { className: "bg-green-500/15 text-green-500 border-green-500/30", icon: CheckCircle2 },
  cancelled: { className: "bg-muted text-muted-foreground border-transparent", icon: Ban },
  failed: { className: "bg-destructive/15 text-destructive border-destructive/30", icon: XCircle },
  // Customer statuses
  active: { className: "bg-green-500/15 text-green-500 border-green-500/30", icon: CheckCircle2 },
  blocked: { className: "bg-destructive/15 text-destructive border-destructive/30", icon: Ban },
  archived: { className: "bg-muted text-muted-foreground border-transparent", icon: PauseCircle },
  // Template version statuses
  approved: { className: "bg-green-500/15 text-green-500 border-green-500/30", icon: CheckCircle2 },
  submitted: { className: "bg-blue-500/15 text-blue-500 border-blue-500/30", icon: Clock },
  rejected: { className: "bg-destructive/15 text-destructive border-destructive/30", icon: XCircle },
  // Consent statuses
  granted: { className: "bg-green-500/15 text-green-500 border-green-500/30", icon: CheckCircle2, label: "Consent granted" },
  revoked: { className: "bg-destructive/15 text-destructive border-destructive/30", icon: XCircle, label: "Consent revoked" },
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const entry = STATUS_STYLES[status] ?? { className: "bg-muted text-muted-foreground border-transparent", icon: HelpCircle };
  const Icon = entry.icon;
  const label = entry.label ?? status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ");
  return (
    <Badge variant="outline" className={cn("gap-1", entry.className, className)} data-testid={`status-badge-${status}`}>
      <Icon className="h-3 w-3" />
      {label}
    </Badge>
  );
}

export default StatusBadge;
