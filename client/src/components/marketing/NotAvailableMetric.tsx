import { HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Renders a metric the backend explicitly marked NOT_AVAILABLE --
 * doc 36's R0-C "AVAILABLE / NOT_AVAILABLE" contract, made visible.
 * NEVER converts NOT_AVAILABLE to 0, an empty chart, or omits the metric
 * entirely (doc 8B-UI brief, section 14, "never fabricate"). The reason
 * string always comes from the API response, never invented here.
 */
export function NotAvailableMetric({ label, reason }: { label: string; reason: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="flex flex-col gap-1 cursor-help text-left" data-testid={`metric-not-available-${label.toLowerCase().replace(/\s+/g, "-")}`}>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              {label}
              <HelpCircle className="h-3 w-3" />
            </span>
            <span className="text-sm font-semibold text-muted-foreground italic">Not available</span>
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p className="text-xs">{reason}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default NotAvailableMetric;
