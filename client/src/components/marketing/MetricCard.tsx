import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export interface MetricCardProps {
  label: string;
  value: string | number;
  sublabel?: string;
  icon?: LucideIcon;
  tone?: "default" | "positive" | "negative" | "warning";
  testId?: string;
}

const TONE_CLASSES: Record<NonNullable<MetricCardProps["tone"]>, string> = {
  default: "text-foreground",
  positive: "text-green-500",
  negative: "text-destructive",
  warning: "text-amber-500",
};

/** A real, backend-sourced number only -- every caller must pass a value that came from an API response, never a client-computed guess (doc 36/Phase 8B-UI section 14). */
export function MetricCard({ label, value, sublabel, icon: Icon, tone = "default", testId }: MetricCardProps) {
  return (
    <Card data-testid={testId ?? `metric-card-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardContent className="p-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground truncate">{label}</p>
          <p className={cn("text-2xl font-bold tabular-nums mt-1", TONE_CLASSES[tone])}>{value}</p>
          {sublabel && <p className="text-xs text-muted-foreground mt-1">{sublabel}</p>}
        </div>
        {Icon && <Icon className="h-5 w-5 text-muted-foreground shrink-0" />}
      </CardContent>
    </Card>
  );
}

export default MetricCard;
